import Link from "next/link";
import { SITE } from "@/lib/siteTokens";

export function Footer() {
  return (
    <footer className="border-t border-[var(--border)] bg-[var(--bg-soft)] py-12">
      <div className={`${SITE.shell} grid gap-8 text-sm sm:grid-cols-2 lg:grid-cols-4`}>
        <div>
          <div className="mb-3 font-bold">nost</div>
          <p className="text-[13px] leading-relaxed text-[var(--fg-muted)]">
            자주 여는 앱, 문서, 탭, 문장을 카드로 묶는 Windows 작업 런처.
          </p>
        </div>
        <FooterCol title="Product" links={[{ href: "/#features", label: "Features" }, { href: "/learn", label: "Learn" }, { href: "/#download", label: "Download" }]} />
        <FooterCol title="Resources" links={[{ href: "https://github.com/HwigwanJi/nost", label: "GitHub" }, { href: "https://github.com/HwigwanJi/nost/releases", label: "Releases" }]} />
        <FooterCol title="Legal" links={[{ href: "https://github.com/HwigwanJi/nost/blob/main/docs/PRIVACY.md", label: "Privacy" }]} />
      </div>
      <div className={`${SITE.shell} mt-10 text-[12px] text-[var(--fg-dim)]`}>© {new Date().getFullYear()} nost</div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <div>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--fg-dim)]">{title}</div>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-[13px] text-[var(--fg-muted)] hover:text-[var(--fg)]">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
