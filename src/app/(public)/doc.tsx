import s from "./doc.module.css";

export type Section = { id: string; title: string; body: React.ReactNode };

/** Long-form page: title block, sticky contents list, numbered sections. */
export function Doc({ eyebrow, title, updated, intro, sections }: { eyebrow: string; title: string; updated: string; intro: React.ReactNode; sections: Section[] }) {
  return (
    <div className={s.doc}>
      <aside className={s.toc}>
        <div className="eyebrow">On this page</div>
        <ol>{sections.map((x) => <li key={x.id}><a href={`#${x.id}`}>{x.title}</a></li>)}</ol>
      </aside>
      <article className={s.body}>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className={s.updated}>Last updated {updated}</p>
        <div className={s.intro}>{intro}</div>
        {sections.map((x, i) => (
          <section key={x.id} id={x.id}>
            <h2><span className="mono">{i + 1}.</span> {x.title}</h2>
            {x.body}
          </section>
        ))}
      </article>
    </div>
  );
}
