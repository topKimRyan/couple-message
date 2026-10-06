/**
 * 기본 fetch. Workers 의 fetch 는 객체 메서드로 부르면(this.fetchFn(...)) "Illegal invocation" 으로 실패한다.
 * 클래스 필드에 fetch 를 그대로 넣지 말고 항상 이 함수를 쓴다. (Node 에서는 문제가 안 보여서 테스트가 놓쳤던 버그)
 */
export const globalFetch: typeof fetch = (input, init) => fetch(input, init);
