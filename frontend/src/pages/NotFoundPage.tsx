import { AppLink } from "../components/AppLink";

export function NotFoundPage() {
  return <section className="panel not-found"><p className="eyebrow">404</p><h1>페이지를 찾을 수 없습니다</h1><p>주소를 확인하거나 작업 목록으로 돌아가 주세요.</p><AppLink className="button button--primary" to="/">작업 목록으로</AppLink></section>;
}
