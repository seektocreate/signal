const ITEMS = [
  { href: "#scout", label: "Scout" },
  { href: "#themes", label: "Themes" },
  { href: "#drafts", label: "Drafts" },
  { href: "#eval", label: "Eval" },
  { href: "#pipeline", label: "Pipeline" },
];

export function AnchorNav() {
  return (
    <nav className="sticky top-0 z-10 border-b border-chalk bg-eggshell">
      <div className="fade-right-mobile overflow-x-auto">
        <div className="mx-auto flex max-w-[1280px] items-center gap-default px-default py-tight text-caption text-gravel">
          {ITEMS.map((item, i) => (
            <span key={item.href} className="flex shrink-0 items-center gap-default">
              {i > 0 && <span aria-hidden="true">·</span>}
              <a
                href={item.href}
                className="tap-target font-medium hover:text-obsidian"
              >
                {item.label}
              </a>
            </span>
          ))}
        </div>
      </div>
    </nav>
  );
}
