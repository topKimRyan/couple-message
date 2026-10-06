import { signInWithCustomToken } from 'firebase/auth';
import { ApiError, createRoom, login } from '../api';
import { deriveRoomKeys, InputError, type LoginInput } from '../crypto';
import { auth } from '../firebase';
import { getDeviceId, saveSession, type Session } from '../session';
import { MAILBOX_SVG } from '../ui/mailbox-icon';

interface Options {
  notice?: string;
  onEnter: (session: Session) => void;
}

const TEMPLATE = `
  <header class="brand">
    <div class="brand-mark">${MAILBOX_SVG}<h1>커플 우체통</h1></div>
    <p>둘만 아는 다섯 가지로 언제든 다시 들어와요.</p>
  </header>
  <form class="card login envelope" novalidate>
    <div class="row">
      <label>내 이름<input name="myName" autocomplete="off" placeholder="예: 김민수" required /></label>
      <label>상대 이름<input name="partnerName" autocomplete="off" placeholder="예: 이지은" required /></label>
    </div>
    <div class="row">
      <label>내 생일<input name="myBirth" type="date" required /></label>
      <label>상대 생일<input name="partnerBirth" type="date" required /></label>
    </div>
    <label>사귄 날<input name="anniversary" type="date" required /></label>

    <label class="toggle"><input type="checkbox" name="isNew" /> 처음이에요, 방을 만들래요</label>
    <label class="invite" hidden>초대 코드<input name="inviteCode" autocomplete="off" autocapitalize="characters" /></label>

    <p class="message" role="alert"></p>
    <button type="submit">들어가기</button>
    <p class="hint">이름은 띄어쓰기와 영문 대소문자를 구분하지 않아요. 두 사람이 각자 "내 이름" 칸에 자기 이름을 쓰면 돼요.</p>
  </form>
`;

export function renderLogin(root: HTMLElement, { notice, onEnter }: Options) {
  root.innerHTML = TEMPLATE;
  const form = root.querySelector('form')!;
  const message = form.querySelector<HTMLElement>('.message')!;
  const button = form.querySelector('button')!;
  const isNew = form.elements.namedItem('isNew') as HTMLInputElement;
  const inviteRow = form.querySelector<HTMLElement>('.invite')!;

  message.textContent = notice ?? '';
  isNew.addEventListener('change', () => {
    inviteRow.hidden = !isNew.checked;
    button.textContent = isNew.checked ? '방 만들기' : '들어가기';
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const field = (name: string) => String(data.get(name) ?? '');
    const input: LoginInput = {
      myName: field('myName'),
      partnerName: field('partnerName'),
      myBirth: field('myBirth'),
      partnerBirth: field('partnerBirth'),
      anniversary: field('anniversary'),
    };
    const inviteCode = field('inviteCode');
    if (isNew.checked && !inviteCode.trim()) {
      message.textContent = '초대 코드를 입력해 주세요.';
      return;
    }

    button.disabled = true;
    message.textContent = '확인하고 있어요. 몇 초 걸릴 수 있어요…';
    try {
      const keys = await deriveRoomKeys(input);
      const deviceId = getDeviceId();
      const { token } = isNew.checked
        ? await createRoom({ inviteCode, roomId: keys.roomId, side: keys.side, deviceId })
        : await login({ roomId: keys.roomId, side: keys.side, deviceId });
      await signInWithCustomToken(auth, token);
      const session: Session = { ...keys, anniversary: input.anniversary };
      await saveSession(session);
      onEnter(session);
    } catch (err) {
      message.textContent =
        err instanceof InputError || err instanceof ApiError ? err.message : '문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
      button.disabled = false;
    }
  });
}
