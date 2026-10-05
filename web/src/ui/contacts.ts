import type { Side } from '../crypto';
import { relativeTime } from '../format';
import { CONTACT_MAX, notifyPartner, saveContact, type ContactView, type RoomView } from '../room-data';
import type { Session } from '../session';
import { el } from './dom';

const PLACEHOLDER = '전화번호, 인스타, 카톡 아이디처럼 지금 연락되는 곳을 적어 두세요.';

/** 방 맨 위의 최신 연락처 칸. 자기 칸만 고칠 수 있다. */
export function createContacts(session: Session) {
  const partnerSide: Side = session.side === 'a' ? 'b' : 'a';
  let current: RoomView['contacts'] | null = null;
  let editing = false;

  const mineBody = el('div');
  const partnerBody = el('div');
  const root = el(
    'section',
    { className: 'card contacts' },
    el('h2', { textContent: '최신 연락처' }),
    el('div', { className: 'contact' }, el('h3', { textContent: '상대' }), partnerBody),
    el('div', { className: 'contact mine' }, el('h3', { textContent: '나' }), mineBody),
  );

  function view(contact: ContactView | null | undefined, emptyText: string): Node[] {
    if (!contact) return [el('p', { className: 'empty', textContent: emptyText })];
    return [
      contact.text === null
        ? el('p', { className: 'empty', textContent: '내용을 열 수 없어요.' })
        : el('p', { className: 'contact-text', textContent: contact.text }),
      el('p', { className: 'meta', textContent: `${relativeTime(contact.updatedAt)} 수정` }),
    ];
  }

  function renderPartner() {
    partnerBody.replaceChildren(...view(current?.[partnerSide], '아직 적지 않았어요.'));
  }

  function renderMine() {
    if (editing) return;
    mineBody.replaceChildren(
      ...view(current?.[session.side], '아직 적지 않았어요.'),
      el('button', { type: 'button', className: 'small', textContent: '고치기', onclick: startEdit }),
    );
  }

  function startEdit() {
    editing = true;
    const textarea = el('textarea', {
      rows: 3,
      maxLength: CONTACT_MAX,
      placeholder: PLACEHOLDER,
      value: current?.[session.side]?.text ?? '',
    });
    const message = el('p', { className: 'message', role: 'alert' });
    const save = el('button', { type: 'submit', className: 'small', textContent: '저장' });
    const cancel = el('button', { type: 'button', className: 'small secondary', textContent: '취소' });
    const form = el('form', { className: 'edit' }, textarea, message, el('div', { className: 'actions' }, cancel, save));

    cancel.onclick = () => {
      editing = false;
      renderMine();
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      save.disabled = true;
      message.textContent = '';
      try {
        await saveContact(session, textarea.value.trim());
        void notifyPartner('contacts');
        editing = false;
        renderMine();
      } catch {
        message.textContent = '저장하지 못했어요. 인터넷 연결을 확인해 주세요.';
        save.disabled = false;
      }
    };
    mineBody.replaceChildren(form);
    textarea.focus();
  }

  return {
    root,
    update(contacts: RoomView['contacts']) {
      current = contacts;
      renderPartner();
      renderMine();
    },
  };
}
