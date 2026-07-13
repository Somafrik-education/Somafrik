import { BrandLogo } from "../BrandLogo";
import { AppNavContent } from "./AppNavContent";

export function Sidebar() {
  return (
    <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
      <div className="px-6 py-5">
        <BrandLogo size="lg" />
      </div>
      <AppNavContent />
    </aside>
  );
}
