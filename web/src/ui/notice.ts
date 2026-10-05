import { canInstall, enablePush, isStandalone, onInstallAvailable, promptInstall, pushStatus, syncPushToken } from '../pwa';
import type { Session } from '../session';
import { el } from './dom';

const DISMISS_PREFIX = 'couple-mailbox/dismissed/';

type Kind = 'ios-install' | 'push' | 'push-denied' | 'install';

function isDismissed(kind: Kind): boolean {
  try {
    return localStorage.getItem(DISMISS_PREFIX + kind) === '1';
  } catch {
    return false;
  }
}

function dismiss(kind: Kind): void {
  try {
    localStorage.setItem(DISMISS_PREFIX + kind, '1');
  } catch {
    // 이번 화면에서만 닫힌다.
  }
}

/**
 * 방 화면 위쪽 안내 카드. 하나만 보여 준다.
 * 아이폰 홈 화면 추가 안내 > 알림 받기 > 알림 꺼짐 안내 > (안드로이드) 홈 화면에 추가
 */
export function createNotice(session: Session) {
  const root = el('section', { className: 'card notice', hidden: true });

  function show(kind: Kind, text: string, action?: { label: string; run: () => Promise<void> }) {
    if (isDismissed(kind)) {
      root.hidden = true;
      return;
    }
    const close = el('button', {
      type: 'button',
      className: 'small secondary',
      textContent: '닫기',
      onclick: () => {
        dismiss(kind);
        root.hidden = true;
      },
    });
    const buttons = el('div', { className: 'actions' }, close);
    if (action) {
      const button = el('button', { type: 'button', className: 'small', textContent: action.label });
      button.onclick = async () => {
        button.disabled = true;
        await action.run().catch(() => {});
        button.disabled = false;
      };
      buttons.append(button);
    }
    root.replaceChildren(el('p', { className: 'notice-text', textContent: text }), buttons);
    root.hidden = false;
  }

  async function refresh() {
    const status = await pushStatus();
    if (status === 'needs-install') {
      return show(
        'ios-install',
        '아이폰은 홈 화면에 추가해야 새 편지 알림을 받을 수 있어요. 아래쪽 공유 버튼 → "홈 화면에 추가"를 누르고, 추가된 아이콘으로 열어 주세요.',
      );
    }
    if (status === 'default') {
      return show('push', '새 편지가 오거나 상대 연락처가 바뀌면 알려 드릴까요?', {
        label: '알림 받기',
        run: async () => {
          await enablePush(session.roomId);
          await refresh();
        },
      });
    }
    if (status === 'granted') syncPushToken(session.roomId).catch((err) => console.warn('push token', err));
    if (status === 'denied') {
      return show('push-denied', '알림이 꺼져 있어요. 휴대폰이나 브라우저 설정에서 이 사이트의 알림을 허용하면 새 편지를 알려 드려요.');
    }
    if (!isStandalone() && canInstall()) {
      return show('install', '홈 화면에 추가하면 앱처럼 바로 열 수 있어요.', {
        label: '추가하기',
        run: async () => {
          if (await promptInstall()) root.hidden = true;
        },
      });
    }
    root.hidden = true;
  }

  const stopListening = onInstallAvailable(() => void refresh());
  void refresh();
  return { root, stop: stopListening };
}
