import '../style.css';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import { ApiError, deleteRoom } from '../api';
import { formatDate, relativeTime } from '../format';
import { el } from '../ui/dom';
import { adminAuth, adminDb } from './firebase';
import { formatInviteCode, generateInviteCode, quietDays, sortByQuiet, type RoomRow } from './logic';

// 운영자 화면: 초대 코드 발급, 방 현황, 방 삭제. 편지와 연락처 내용은 보이지 않는다(암호문이고 규칙으로도 막힘).

interface InviteRow {
  code: string;
  alias: string;
  used: boolean;
  createdAt: Date | null;
  usedAt: Date | null;
  roomDeletedAt: Date | null;
}

const root = document.getElementById('app')!;
const toDate = (v: unknown) => (v as Timestamp | undefined)?.toDate?.() ?? null;

function header(user: User | null): HTMLElement {
  return el(
    'header',
    { className: 'brand' },
    el('h1', { textContent: '우체통 운영' }),
    user
      ? el(
          'p',
          {},
          `${user.email} · `,
          el('button', { type: 'button', className: 'link inline', textContent: '로그아웃', onclick: () => signOut(adminAuth) }),
        )
      : el('p', { textContent: '운영자만 들어올 수 있어요.' }),
  );
}

function renderSignIn(message = '') {
  const status = el('p', { className: 'message', role: 'alert', textContent: message });
  const button = el('button', { type: 'button', textContent: '구글 계정으로 로그인' });
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = '';
    try {
      await signInWithPopup(adminAuth, new GoogleAuthProvider());
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        status.textContent = '로그인하지 못했어요. 팝업 차단을 확인해 주세요.';
      }
      button.disabled = false;
    }
  };
  const section = el('section', { className: 'card login' }, status, button);
  if (import.meta.env.VITE_USE_EMULATORS === 'true') section.append(emulatorSignIn(status));
  root.replaceChildren(header(null), section);
}

/**
 * 로컬 개발 전용. Auth 에뮬레이터는 가짜 구글 자격 증명을 받아 준다.
 * (구글 팝업은 apis.google.com 스크립트가 필요해서 오프라인·제한된 환경에서는 안 열린다)
 */
function emulatorSignIn(status: HTMLElement): HTMLElement {
  const email = el('input', { type: 'email', value: 'admin@example.com' });
  const form = el(
    'form',
    { className: 'edit' },
    el('label', {}, '에뮬레이터: 이 이메일로 구글 로그인', email),
    el('button', { type: 'submit', className: 'small secondary', textContent: '에뮬레이터 로그인' }),
  );
  form.onsubmit = async (event) => {
    event.preventDefault();
    const credential = GoogleAuthProvider.credential(
      JSON.stringify({ sub: `emu-${email.value}`, email: email.value, email_verified: true }),
    );
    await signInWithCredential(adminAuth, credential).catch(() => {
      status.textContent = '에뮬레이터 로그인 실패';
    });
  };
  return form;
}

async function load(): Promise<{ rooms: RoomRow[]; invites: InviteRow[] }> {
  const [roomSnap, inviteSnap] = await Promise.all([
    getDocs(collection(adminDb, 'rooms')),
    getDocs(collection(adminDb, 'invites')),
  ]);
  const invites = inviteSnap.docs.map((d) => ({
    code: d.id,
    alias: String(d.get('alias') ?? ''),
    used: d.get('used') === true,
    createdAt: toDate(d.get('createdAt')),
    usedAt: toDate(d.get('usedAt')),
    roomDeletedAt: toDate(d.get('roomDeletedAt')),
  }));
  const aliasByCode = new Map(invites.map((i) => [i.code, i.alias]));
  const rooms = roomSnap.docs.map((d) => ({
    roomId: d.id,
    alias: aliasByCode.get(String(d.get('inviteCode'))) || null,
    createdAt: toDate(d.get('createdAt')) ?? new Date(0),
    lastLetterAt: toDate(d.get('lastLetterAt')),
  }));
  return { rooms, invites };
}

async function renderAdmin(user: User) {
  const status = el('p', { className: 'message', role: 'alert' });
  /** 안내 문구. 기본은 오류(빨간색), ok 면 보통 글자색. */
  const say = (text: string, ok = false) => {
    status.textContent = text;
    status.classList.toggle('ok', ok);
  };
  const roomList = el('ol', { className: 'admin-list' });
  const inviteList = el('ol', { className: 'admin-list' });

  // 초대 코드 만들기
  const aliasInput = el('input', { maxLength: 40, placeholder: '예: 건우 커플', autocomplete: 'off' });
  const created = el('div', { className: 'created', hidden: true });
  const createButton = el('button', { type: 'submit', textContent: '만들기' });
  const createForm = el(
    'form',
    { className: 'card login' },
    el('h2', { textContent: '초대 코드 만들기' }),
    el('label', {}, '누구에게 줄 코드인지 (나만 보는 별칭)', aliasInput),
    createButton,
    created,
  );
  createForm.onsubmit = async (event) => {
    event.preventDefault();
    const alias = aliasInput.value.trim();
    if (!alias) {
      say('별칭을 적어 주세요.');
      return;
    }
    createButton.disabled = true;
    try {
      const code = generateInviteCode();
      await setDoc(doc(adminDb, 'invites', code), { alias, used: false, createdAt: serverTimestamp() });
      aliasInput.value = '';
      created.replaceChildren(
        el('p', { className: 'code', textContent: formatInviteCode(code) }),
        el('p', { className: 'hint', textContent: `${alias}에게 전해 주세요. 방 하나를 만들 때 한 번만 쓸 수 있어요.` }),
        copyButton(formatInviteCode(code)),
      );
      created.hidden = false;
      say('');
      await refresh();
    } catch {
      say('초대 코드를 만들지 못했어요.');
    }
    createButton.disabled = false;
  };

  root.replaceChildren(
    header(user),
    status,
    createForm,
    el('section', {}, el('h2', { textContent: '방 현황' }), el('p', { className: 'hint', textContent: '오래 연락이 없는 방이 위에 있어요.' }), roomList),
    el('section', {}, el('h2', { textContent: '초대 코드' }), inviteList),
  );

  function copyButton(text: string) {
    const button = el('button', { type: 'button', className: 'small secondary', textContent: '복사' });
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = '복사했어요';
      } catch {
        button.textContent = '직접 복사해 주세요';
      }
    };
    return button;
  }

  function roomItem(room: RoomRow): HTMLElement {
    const days = quietDays(room);
    const badge = days > 0 ? `${days}일째 조용` : room.lastLetterAt ? '오늘 연락' : '오늘 만든 방';
    const actions = el('div', { className: 'actions' });
    const ask = el('button', { type: 'button', className: 'small secondary', textContent: '방 삭제' });
    ask.onclick = () => {
      const confirm = el('button', { type: 'button', className: 'small danger', textContent: '삭제' });
      const cancel = el('button', { type: 'button', className: 'small secondary', textContent: '취소' });
      cancel.onclick = () => actions.replaceChildren(ask);
      confirm.onclick = async () => {
        confirm.disabled = cancel.disabled = true;
        try {
          await deleteRoom(await user.getIdToken(), room.roomId);
          say(`${room.alias ?? '방'}을 지웠어요.`, true);
          await refresh();
        } catch (err) {
          say(err instanceof ApiError ? err.message : '방을 지우지 못했어요.');
          confirm.disabled = cancel.disabled = false;
        }
      };
      actions.replaceChildren(
        el('p', { className: 'warn', textContent: '편지와 연락처가 모두 사라지고 되돌릴 수 없어요.' }),
        cancel,
        confirm,
      );
    };
    actions.append(ask);
    return el(
      'li',
      { className: 'card' },
      el(
        'div',
        { className: 'row-head' },
        el('strong', { textContent: room.alias ?? '(별칭 없음)' }),
        el('span', { className: `badge${days >= 30 ? ' quiet' : ''}`, textContent: badge }),
      ),
      el('p', {
        className: 'meta',
        textContent: `만든 날 ${formatDate(room.createdAt)} · 마지막 편지 ${room.lastLetterAt ? relativeTime(room.lastLetterAt) : '아직 없음'}`,
      }),
      actions,
    );
  }

  function inviteItem(invite: InviteRow): HTMLElement {
    const state = invite.roomDeletedAt
      ? `방 삭제됨 · ${formatDate(invite.roomDeletedAt)}`
      : invite.used
        ? `사용됨${invite.usedAt ? ` · ${formatDate(invite.usedAt)}` : ''}`
        : '아직 안 씀';
    const actions = el('div', { className: 'actions' });
    const rename = el('button', { type: 'button', className: 'small secondary', textContent: '별칭 고치기' });
    rename.onclick = async () => {
      const alias = prompt('새 별칭', invite.alias)?.trim();
      if (!alias || alias === invite.alias) return;
      await updateDoc(doc(adminDb, 'invites', invite.code), { alias: alias.slice(0, 40) }).catch(() => {
        say('별칭을 고치지 못했어요.');
      });
      await refresh();
    };
    actions.append(rename);
    if (!invite.used) {
      actions.prepend(copyButton(formatInviteCode(invite.code)));
      const revoke = el('button', { type: 'button', className: 'small secondary', textContent: '취소' });
      revoke.onclick = async () => {
        if (!window.confirm(`${invite.alias}의 초대 코드를 취소할까요?`)) return;
        await deleteDoc(doc(adminDb, 'invites', invite.code)).catch(() => {
          say('초대 코드를 취소하지 못했어요.');
        });
        await refresh();
      };
      actions.append(revoke);
    }
    return el(
      'li',
      { className: 'card' },
      el('div', { className: 'row-head' }, el('strong', { textContent: invite.alias || '(별칭 없음)' }), el('span', { className: 'badge', textContent: state })),
      el('p', { className: 'meta code-inline', textContent: formatInviteCode(invite.code) }),
      actions,
    );
  }

  async function refresh() {
    try {
      const { rooms, invites } = await load();
      roomList.replaceChildren(
        ...(rooms.length ? sortByQuiet(rooms).map(roomItem) : [el('li', { className: 'empty', textContent: '아직 방이 없어요.' })]),
      );
      const sorted = [...invites].sort(
        (a, b) => Number(a.used) - Number(b.used) || (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
      );
      inviteList.replaceChildren(
        ...(sorted.length ? sorted.map(inviteItem) : [el('li', { className: 'empty', textContent: '아직 초대 코드가 없어요.' })]),
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'permission-denied') {
        await signOut(adminAuth);
        renderSignIn(`${user.email}은 운영자 계정이 아니에요.`);
      } else {
        say('불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
      }
    }
  }

  await refresh();
}

onAuthStateChanged(adminAuth, (user) => {
  if (user) void renderAdmin(user);
  else renderSignIn();
});
