import { formatDateTime, relativeTime } from '../format';
import { LETTER_MAX, editLetter, notifyPartner, sendLetter, type LetterView } from '../room-data';
import type { Session } from '../session';
import { el } from './dom';

interface Options {
  onMore: () => void;
}

/** 쌓인 편지 목록(오래된 것부터)과 편지 쓰기. */
export function createLetters(session: Session, { onMore }: Options) {
  const more = el('button', { type: 'button', className: 'link', textContent: '이전 편지 더 보기', hidden: true, onclick: onMore });
  const list = el('ol', { className: 'letters' });
  const empty = el('p', { className: 'empty', textContent: '아직 편지가 없어요. 첫 안부를 남겨 보세요.', hidden: true });

  const textarea = el('textarea', { rows: 4, maxLength: LETTER_MAX, placeholder: '잘 지내? 요즘 어떻게 지내는지 남겨 주세요.' });
  const counter = el('span', { className: 'meta' });
  const message = el('p', { className: 'message', role: 'alert' });
  const send = el('button', { type: 'submit', textContent: '보내기' });
  const composer = el(
    'form',
    { className: 'card composer' },
    el('p', { className: 'composer-title', textContent: '편지 쓰기' }),
    textarea,
    el('div', { className: 'actions' }, counter, send),
    message,
  );

  const root = el('section', { className: 'letters-section' }, el('h2', { textContent: '안부 편지' }), more, empty, list, composer);

  // 이번 방문에서 처음 읽은 편지는 "새 편지"로 강조해 둔다.
  const fresh = new Set<string>();
  let lastId: string | undefined;
  let lastLetters: LetterView[] = [];
  let lastHasMore = false;
  // 고치는 중인 편지. 목록이 다시 그려져도 쓰던 내용이 남도록 여기에 둔다.
  let editing: { id: string; draft: string; error: string; busy: boolean; focus: boolean } | null = null;

  const updateCounter = () => {
    counter.textContent = `${textarea.value.length} / ${LETTER_MAX}`;
    send.disabled = textarea.value.trim().length === 0;
  };
  textarea.addEventListener('input', updateCounter);
  updateCounter();

  composer.onsubmit = async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    // 목록에는 바로 나타나므로 입력 칸을 먼저 비운다. 실패하면 되돌린다.
    textarea.value = '';
    updateCounter();
    message.textContent = '';
    try {
      await sendLetter(session, text);
      void notifyPartner('letter');
    } catch {
      textarea.value = text;
      updateCounter();
      message.textContent = '보내지 못했어요. 인터넷 연결을 확인하고 다시 보내 주세요.';
    }
  };

  function editor(letter: LetterView): HTMLElement {
    const state = editing!;
    const area = el('textarea', { rows: 4, maxLength: LETTER_MAX, value: state.draft, disabled: state.busy });
    const save = el('button', { type: 'submit', textContent: '저장', disabled: state.busy || state.draft.trim().length === 0 });
    const cancel = el('button', {
      type: 'button',
      className: 'secondary',
      textContent: '취소',
      disabled: state.busy,
      onclick: () => {
        editing = null;
        render();
      },
    });
    area.addEventListener('input', () => {
      state.draft = area.value;
      save.disabled = area.value.trim().length === 0;
    });
    const form = el(
      'form',
      { className: 'edit-form' },
      area,
      el('div', { className: 'actions' }, cancel, save),
      el('p', { className: 'message', role: 'alert', textContent: state.error }),
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      const text = state.draft.trim();
      if (!text) return;
      if (text === letter.text) {
        editing = null;
        return render();
      }
      state.busy = true;
      state.error = '';
      render();
      try {
        await editLetter(session, letter.id, text);
        if (editing === state) editing = null;
        void notifyPartner('letter');
      } catch {
        state.busy = false;
        state.error = '고치지 못했어요. 인터넷 연결을 확인하고 다시 저장해 주세요.';
      }
      render();
    };
    if (state.focus) {
      state.focus = false;
      queueMicrotask(() => {
        area.focus();
        area.setSelectionRange(area.value.length, area.value.length);
      });
    }
    return form;
  }

  function item(letter: LetterView): HTMLElement {
    const mine = letter.from === session.side;
    const status = mine
      ? letter.pending
        ? '보내는 중…'
        : letter.readAt
          ? `읽음 (${relativeTime(letter.readAt)})`
          : '아직 안 읽음'
      : fresh.has(letter.id)
        ? '새 편지'
        : '';
    const isFresh = fresh.has(letter.id);
    const isEditing = editing?.id === letter.id;
    const canEdit = mine && !letter.pending && letter.text !== null && !isEditing;
    return el(
      'li',
      { className: `letter ${mine ? 'mine' : 'theirs'}${isFresh ? ' fresh' : ''}` },
      isFresh && el('span', { className: 'seal', textContent: '새', title: '새 편지' }),
      isEditing
        ? editor(letter)
        : letter.text === null
          ? el('p', { className: 'empty', textContent: '이 편지는 열 수 없어요.' })
          : el('p', { className: 'letter-text', textContent: letter.text }),
      el(
        'div',
        { className: 'letter-foot' },
        el('span', { className: 'signature', textContent: mine ? '— 내가' : '— 너에게서' }),
        el('p', {
          className: 'meta',
          textContent: [formatDateTime(letter.sentAt), letter.editedAt ? '수정됨' : '', status].filter(Boolean).join(' · '),
        }),
      ),
      canEdit
        ? el('button', {
            type: 'button',
            className: 'link inline',
            textContent: '수정',
            onclick: () => {
              editing = { id: letter.id, draft: letter.text!, error: '', busy: false, focus: true };
              render();
            },
          })
        : null,
    );
  }

  function render() {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 200;
    const letters = lastLetters;
    // 고치던 편지가 목록에서 사라지면 편집을 끝낸다.
    if (editing && !letters.some((l) => l.id === editing!.id)) editing = null;
    more.hidden = !lastHasMore;
    empty.hidden = letters.length > 0;
    list.replaceChildren(...letters.map(item));
    // 처음 열 때와, 맨 아래를 보고 있는데 새 편지가 오면 맨 아래로.
    const newLastId = letters.at(-1)?.id;
    if (newLastId && newLastId !== lastId && (lastId === undefined || nearBottom)) {
      composer.scrollIntoView({ block: 'end' });
    }
    lastId = newLastId;
  }

  return {
    root,
    markFresh(id: string) {
      fresh.add(id);
    },
    update(letters: LetterView[], hasMore: boolean) {
      lastLetters = letters;
      lastHasMore = hasMore;
      render();
    },
  };
}
