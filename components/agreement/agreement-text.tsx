import type { AgreementDoc } from "@/lib/agreement"

/** The agreement text exactly as stored for a version: header + sections 1-11. */
export function AgreementText({ doc }: { doc: AgreementDoc }) {
  return (
    <>
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-primary">{doc.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{doc.title}</h1>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
          <span>
            Version <b className="font-semibold text-foreground">{doc.version}</b>
          </span>
          <span>
            Effective <b className="font-semibold text-foreground">{doc.effectiveLabel}</b>
          </span>
          <span>{doc.company}</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground print:hidden">{doc.readPrompt}</p>
      </header>

      {doc.sections.map((s) => (
        <section
          key={s.heading}
          className="rounded-xl bg-card p-5 text-sm leading-relaxed ring-1 ring-foreground/10 sm:p-6 print:p-0 print:pb-3 print:ring-0"
        >
          <h2 className="mb-2 text-base font-semibold">{s.heading}</h2>
          {s.blocks.map((b, i) =>
            b.type === "p" ? (
              <p key={i} className="my-2">
                {b.text}
              </p>
            ) : (
              <ol key={i} className="my-2 list-decimal space-y-1.5 pl-5">
                {b.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            ),
          )}
        </section>
      ))}
    </>
  )
}
