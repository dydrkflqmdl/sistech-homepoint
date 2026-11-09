// 화면(DOM) 도우미: 요소 만들기·채우기, 알림 칸, 초점 돌려놓기. 앱 상태는 모른다.

export const $ = (selector) => document.querySelector(selector);

// `조건 && h(...)` 꼴로 넣은 자식 중 거짓 값(false, null, '')을 버린다.
// DOM의 append/replaceChildren에 false를 그대로 넘기면 "false"라는 글자가 화면에 찍히므로 반드시 거쳐야 한다.
// 배열 안의 배열도 끝까지 펼친다. 한 단계만 펼치면 안쪽 배열이 "false,false" 같은 글자로 찍힌다.
const compact = (children) => children.flat(Infinity).filter((c) => c != null && c !== false && c !== '');

// 작은 DOM 생성 도우미. 문자열은 모두 텍스트로 들어가므로 CSV에서 온 값이 HTML로 해석되지 않는다.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...compact(children));
  return el;
}

// el의 자식을 통째로 바꾼다. h()와 같은 규칙으로 거짓 값을 버린다.
export const fill = (el, ...children) => el.replaceChildren(...compact(children));

// 알림 칸(#toast, aria-live)은 늘 DOM에 두고 글자만 바꾼다. 숨겼다 보였다 하면 화면 읽기 프로그램이 첫 알림을 놓친다.
// 시간이 지나면 글자를 비우고, 빈 칸은 CSS가 투명하게 둔다.
let toastTimer;
export function toast(message) {
  const el = $('#toast');
  el.hidden = false;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.textContent = '';
  }, 3500);
}

// 다시 그리면 누른 버튼·체크 상자가 새로 만들어지므로, 키보드로 쓰던 사람을 위해 같은 자리로 초점을 돌려놓는다.
export function refocus(selector) {
  $(selector)?.focus({ preventScroll: true });
}

// 장소를 고른 뒤 상세 정보 제목으로 초점을 옮긴다. 키보드·화면 읽기 프로그램 사용자가 바로 이어서 읽을 수 있다.
export const focusDetailTitle = () => refocus('#detail-title');
