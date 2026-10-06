import './_group.css';
import { LogoPreview } from './_shared/LogoPreview';

export function Current() {
  return <LogoPreview geometry="current" compactToggle={false} />;
}
