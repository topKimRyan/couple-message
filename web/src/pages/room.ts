import type { FirestoreError, Unsubscribe } from 'firebase/firestore';
import { daysTogether, daysUntil } from '../dday';
import { markRead, saveSettings, watchLetters, watchRoom, type LetterView, type Settings } from '../room-data';
import type { Session } from '../session';
import { createContacts } from '../ui/contacts';
import { el } from '../ui/dom';
import { createLetters } from '../ui/letters';
import { createNotice } from '../ui/notice';

interface Options {
  onLeave: (notice?: string) => void;
}

const PAGE_SIZE = 50;

function graduationText(graduation: string | null): string {
  if (!graduation) return '';
  const d = daysUntil(graduation);
  if (d > 0) return `졸업까지 D-${d}`;
  if (d === 0) return '오늘 졸업!';
  return `졸업한 지 ${-d}일`;
}

export function renderRoom(root: HTMLElement, session: Session, { onLeave }: Options) {
  let settings: Settings = { graduation: null };
  let unsubLetters: Unsubscribe | undefined;
  let limit = PAGE_SIZE;
  let latest: { letters: LetterView[]; hasMore: boolean } = { letters: [], hasMore: false };
  const requested = new Set<string>();

  // 머리말: 디데이와 졸업일 설정
  const dday = el('p', { className: 'dday' });
  const gradInput = el('input', { type: 'date' });
  const gradForm = el(
    'form',
    { className: 'card edit', hidden: true },
    el('label', {}, '졸업일', gradInput),
    el(
      'div',
      { className: 'actions' },
      el('button', { type: 'button', className: 'small secondary', textContent: '지우기', onclick: () => saveGraduation(null) }),
      el('button', { type: 'submit', className: 'small', textContent: '저장' }),
    ),
  );
  gradForm.onsubmit = (event) => {
    event.preventDefault();
    saveGraduation(gradInput.value || null);
  };
  const gradToggle = el('button', {
    type: 'button',
    className: 'link inline',
    textContent: '졸업일 설정',
    onclick: () => {
      gradInput.value = settings.graduation ?? '';
      gradForm.hidden = !gradForm.hidden;
    },
  });

  function renderDday() {
    dday.textContent = [`사귄 지 ${daysTogether(session.anniversary)}일`, graduationText(settings.graduation)]
      .filter(Boolean)
      .join(' · ');
  }

  async function saveGraduation(graduation: string | null) {
    try {
      await saveSettings(session, { ...settings, graduation });
      gradForm.hidden = true;
    } catch {
      status.textContent = '졸업일을 저장하지 못했어요.';
    }
  }

  const status = el('p', { className: 'message', role: 'alert' });
  const banner = createNotice(session);
  const contacts = createContacts(session);
  const letters = createLetters(session, {
    onMore: () => {
      limit += PAGE_SIZE;
      subscribeLetters();
    },
  });

  root.replaceChildren(
    el('header', { className: 'brand' }, el('h1', { textContent: '우리 우체통' }), dday, gradToggle),
    gradForm,
    status,
    banner.root,
    contacts.root,
    letters.root,
    el(
      'footer',
      { className: 'footer' },
      el('button', { type: 'button', className: 'link', textContent: '이 기기에서 나가기', onclick: () => leave() }),
      el('p', {
        className: 'hint',
        textContent:
          '편지와 연락처는 암호화해서 저장해요. 다만 다섯 가지 정보를 모두 아는 사람은 이 방에 들어올 수 있어요.',
      }),
    ),
  );
  renderDday();

  // 화면을 보고 있을 때 상대 편지를 읽음 처리한다.
  function markVisibleRead() {
    if (document.visibilityState !== 'visible') return;
    for (const letter of latest.letters) {
      if (letter.from === session.side || letter.readAt || letter.pending || requested.has(letter.id)) continue;
      requested.add(letter.id);
      letters.markFresh(letter.id);
      markRead(session, letter.id).catch(() => requested.delete(letter.id));
    }
  }

  function onVisible() {
    markVisibleRead();
    letters.update(latest.letters, latest.hasMore);
  }

  function handleError(err: FirestoreError) {
    if (err.code === 'permission-denied') {
      leave('다시 로그인해 주세요.');
    } else {
      status.textContent = '방을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
    }
  }

  function subscribeLetters() {
    unsubLetters?.();
    unsubLetters = watchLetters(
      session,
      limit,
      (list, hasMore) => {
        latest = { letters: list, hasMore };
        markVisibleRead();
        letters.update(list, hasMore);
      },
      handleError,
    );
  }

  const unsubRoom = watchRoom(
    session,
    (room) => {
      if (!room) return leave('방이 더 이상 없어요.');
      status.textContent = '';
      contacts.update(room.contacts);
      settings = room.settings;
      renderDday();
    },
    handleError,
  );
  subscribeLetters();
  document.addEventListener('visibilitychange', onVisible);

  let left = false;
  function leave(notice?: string) {
    // 방 문서와 편지 구독이 동시에 권한 오류를 낼 수 있다.
    if (left) return;
    left = true;
    unsubRoom();
    unsubLetters?.();
    banner.stop();
    document.removeEventListener('visibilitychange', onVisible);
    onLeave(notice);
  }
}
