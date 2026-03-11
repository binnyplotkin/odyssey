import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Pandora's Box",
  description:
    "How two guys on a rock in Central Park decided they wanted to be kings — and built the technology to make it possible.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-6 border-b" style={{ borderColor: "var(--border)" }}>
        <Link href="/" className="flex items-center gap-2 text-sm font-medium opacity-70 hover:opacity-100 transition-opacity" style={{ fontFamily: "var(--font-mono)" }}>
          ← Back to Pandora&apos;s Box
        </Link>
        <span className="text-xs opacity-40" style={{ fontFamily: "var(--font-mono)" }}>Origin Story</span>
      </nav>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <p className="text-sm uppercase tracking-widest mb-4 opacity-50" style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>
          The founding myth
        </p>
        <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6" style={{ fontFamily: "var(--font-display)" }}>
          Two Kings.<br />One Rock.<br />Infinite Worlds.
        </h1>
        <p className="text-xl leading-relaxed opacity-70 max-w-xl mx-auto">
          How a conversation in Central Park became an engine for becoming anyone — or anything — you&apos;ve ever imagined.
        </p>
      </section>

      {/* Image */}
      <section className="max-w-3xl mx-auto px-6 pb-16">
        <div
          className="relative w-full rounded-2xl overflow-hidden shadow-xl"
          style={{ border: "1px solid var(--border)" }}
        >
          <Image
            src="/founders-kings.jpg"
            alt="Binny Plotkin and Josh Sassoon, depicted as kings on a rock in Central Park"
            width={1024}
            height={768}
            className="w-full object-cover"
            priority
          />
          <div
            className="absolute bottom-0 left-0 right-0 px-6 py-4 text-xs text-center"
            style={{
              background: "linear-gradient(to top, rgba(16,33,41,0.85), transparent)",
              color: "rgba(255,255,255,0.7)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Artistic impression. Crowns were metaphorical. The rock was very real.
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="max-w-2xl mx-auto px-6 pb-24">
        <article className="prose prose-lg space-y-8" style={{ color: "var(--foreground)" }}>

          <div className="space-y-4">
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              The Rock Incident
            </h2>
            <p className="text-lg leading-relaxed opacity-80">
              It was an unremarkable Tuesday in Central Park. <strong>Binny Plotkin</strong> and <strong>Josh Sassoon</strong> were sitting on a large boulder — because that&apos;s the kind of thing you do when you&apos;re trying to think seriously about the future — and the conversation turned, as it always does between two people with too much imagination and not enough patience for reality, to a single burning question:
            </p>
            <blockquote
              className="text-xl font-medium italic pl-6 py-2"
              style={{ borderLeft: "3px solid var(--accent)", color: "var(--accent-strong)" }}
            >
              &ldquo;What would it actually <em>feel like</em> to be a king?&rdquo;
            </blockquote>
            <p className="text-lg leading-relaxed opacity-80">
              Not a king in the abstract, game-of-chess sense. A real king. With subjects who need things from you. With advisors who are definitely plotting against you. With a treasury that never quite covers the war you got talked into last spring. The full experience — joy, weight, absurdity, and all.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Then Josh Said Something
            </h2>
            <p className="text-lg leading-relaxed opacity-80">
              Binny had barely finished articulating the king thesis when Josh, in a moment of pivot that can only be described as <em>extremely Josh</em>, said:
            </p>
            <blockquote
              className="text-xl font-medium italic pl-6 py-2"
              style={{ borderLeft: "3px solid var(--accent)", color: "var(--accent-strong)" }}
            >
              &ldquo;Dude, what if I could be a 16-year-old goth girl?&rdquo;
            </blockquote>
            <p className="text-lg leading-relaxed opacity-80">
              And Binny, without missing a beat, replied: <em>&ldquo;That is exactly what I&apos;ve always dreamed of.&rdquo;</em>
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              To be clear: neither of them wants to <em>be</em> a 16-year-old goth girl. But they both immediately understood what Josh meant. What would it be like to inhabit a completely different life — different age, different subculture, different set of problems, different inner world — fully? Not as a costume, but as an experience?
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              That question — equal parts philosophical and slightly unhinged — is what Pandora&apos;s Box is built to answer.
            </p>
          </div>

          <div
            className="rounded-2xl p-8 space-y-3"
            style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
          >
            <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>The Thesis</h3>
            <p className="text-base leading-relaxed opacity-80">
              Every person carries within them a vast inner universe — and a quiet curiosity about what it would be like to live in someone else&apos;s. Fiction gets you partway there. Method acting gets you closer. But nothing quite puts you <em>inside</em> an experience the way a living, responsive, adaptive world can.
            </p>
            <p className="text-base leading-relaxed opacity-80">
              Pandora&apos;s Box is an immersive reality engine. You step in. You choose a world. You inhabit a role — king, goth teenager, deep-sea explorer, jazz musician in 1940s Harlem, medieval scholar, or something stranger. And then you live it, with all the texture, consequence, and surprise that a real life deserves.
            </p>
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              The Founders
            </h2>

            <div className="grid sm:grid-cols-2 gap-6">
              <div
                className="rounded-xl p-6 space-y-2"
                style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
              >
                <p className="text-xs uppercase tracking-widest opacity-50" style={{ fontFamily: "var(--font-mono)" }}>Co-founder</p>
                <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Binny Plotkin</h3>
                <p className="text-sm leading-relaxed opacity-70">
                  Builder, storyteller, and the first person to answer &ldquo;what if I could be a goth teenager&rdquo; with genuine philosophical enthusiasm. Binny is drawn to language, mythology, and the idea that every person carries a vast inner infinity waiting to be remembered. Believes the best technology disappears — what remains is the experience.
                </p>
              </div>

              <div
                className="rounded-xl p-6 space-y-2"
                style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
              >
                <p className="text-xs uppercase tracking-widest opacity-50" style={{ fontFamily: "var(--font-mono)" }}>Co-founder</p>
                <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Josh Sassoon</h3>
                <p className="text-sm leading-relaxed opacity-70">
                  The man who, mid-conversation about kingship, pivoted to a 16-year-old goth girl — and was completely serious about it. Josh has an uncanny ability to identify the most interesting version of any idea and say it out loud before anyone has the chance to overthink it. Pandora&apos;s Box exists because of exactly that instinct.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Why Now
            </h2>
            <p className="text-lg leading-relaxed opacity-80">
              The technology to do this well didn&apos;t exist until recently. Language models that can hold a world in memory, generate coherent consequence and dialogue, and adapt to your choices in real time — all of that became possible in a window that spans roughly the last two years.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              The rock in Central Park was always there. It just took a while for the tools to catch up to the conversation that happened on it.
            </p>
          </div>

          {/* CTA */}
          <div className="pt-8 text-center space-y-4">
            <p className="text-base opacity-60">
              Ready to stop being yourself for a while?
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium transition-opacity hover:opacity-80"
              style={{
                background: "var(--accent)",
                color: "#fff",
                fontFamily: "var(--font-mono)",
              }}
            >
              Step into a World →
            </Link>
          </div>

        </article>
      </section>
    </main>
  );
}
