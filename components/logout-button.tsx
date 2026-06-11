// "Sign out" — the quiet counterpart to LoginButton: same pill geometry, but
// outlined and muted so it never competes with a primary action. Point href at
// the server route that clears the session cookies; full-page navigation, so
// it renders as an anchor.
export function LogoutButton({
  href,
  label = "Sign out",
  className = "",
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-10 items-center justify-center rounded-full border border-strong px-5 text-sm font-medium text-muted transition duration-150 ease-standard hover:bg-surface-low hover:text-foreground ${className}`}
    >
      {label}
    </a>
  );
}
