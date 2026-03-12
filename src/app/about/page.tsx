import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About — Pandora's Box",
  description:
    "How two guys on a rock in Central Park decided they wanted to build a door into every world imaginable — and why it matters.",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-6 border-b" style={{ borderColor: "var(--border)" }}>
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
          style={{ fontFamily: "var(--font-mono)" }}
        >
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
          How a single question asked in Central Park became a door into every world you&apos;ve ever imagined — and a few you haven&apos;t.
        </p>
      </section>

      {/* Hero Image — old painting */}
      <section className="max-w-4xl mx-auto px-6 pb-16">
        <div
          className="relative w-full rounded-2xl overflow-hidden shadow-2xl"
          style={{ border: "1px solid var(--border)" }}
        >
          <Image
            src="/about-hero.jpg"
            alt="Two young visionaries sitting on a rock in Central Park, imagining infinite worlds — depicted as an 1820s Romantic oil painting"
            width={1400}
            height={787}
            className="w-full object-cover"
            priority
          />
          <div
            className="absolute bottom-0 left-0 right-0 px-6 py-4 text-xs text-center"
            style={{
              background: "linear-gradient(to top, rgba(10,10,20,0.9), transparent)",
              color: "rgba(255,255,255,0.6)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Central Park, 2024. The rock was real. The crowns were inevitable.
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="max-w-2xl mx-auto px-6 pb-24">
        <article className="space-y-16" style={{ color: "var(--foreground)" }}>

          {/* The Origin */}
          <div className="space-y-5">
            <p className="text-sm uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>I. The Question</p>
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              It Started on a Rock
            </h2>
            <p className="text-lg leading-relaxed opacity-80">
              Somewhere in Central Park, on an unremarkable afternoon that turned out to be remarkably important, <strong>Binny Plotkin</strong> and <strong>Josh Sassoon</strong> were sitting on a boulder — the way serious people sit when they&apos;re trying to think about something bigger than themselves.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              The conversation had that particular quality where the words start saying themselves, and you&apos;re really just listening. They talked about identity. About imagination. About the strange human ache of wanting to know what it would feel like to be someone entirely different — not to escape your life, but to understand it more deeply.
            </p>
            <blockquote
              className="text-2xl font-medium italic pl-6 py-3 my-4"
              style={{ borderLeft: "3px solid var(--accent)", color: "var(--accent-strong)" }}
            >
              &ldquo;What would it actually <em>feel like</em> to be a king?&rdquo;
            </blockquote>
            <p className="text-lg leading-relaxed opacity-80">
              Not a metaphorical king. Not a chess piece. A real one — with weight and responsibility, with subjects who need things from you and advisors who may or may not be plotting something. The texture of a different life, fully inhabited.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              That question cracked something open. And Pandora&apos;s Box was born in the space between the asking and the answer.
            </p>
          </div>

          {/* The Thesis */}
          <div
            className="rounded-2xl p-8 space-y-4"
            style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
          >
            <p className="text-sm uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>The Premise</p>
            <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              What If You Could Step Into Any World?
            </h3>
            <p className="text-base leading-relaxed opacity-80">
              Every person carries within them a vast inner universe — and a quiet, persistent curiosity about what it would feel like to live inside someone else&apos;s. Fiction gets you partway there. Method acting gets you closer. But nothing quite puts you <em>inside</em> an experience the way a living, responsive, adaptive world can.
            </p>
            <p className="text-base leading-relaxed opacity-80">
              Pandora&apos;s Box is an immersive reality engine. You step in. You choose a world. You inhabit a role — medieval king, deep-sea explorer, jazz musician in 1940s Harlem, a space captain navigating the politics of three civilizations. And then you <em>live it</em>, with consequence, surprise, and the full weight of a world that responds to you.
            </p>
          </div>

          {/* Three Use Cases */}
          <div className="space-y-5">
            <p className="text-sm uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>II. Why It Matters</p>
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Three Doors. One Box.
            </h2>
            <p className="text-lg leading-relaxed opacity-80">
              Pandora&apos;s Box isn&apos;t just entertainment. It&apos;s a tool for the examined life — one that can unlock different things in different people.
            </p>
          </div>

          {/* Use Case 1 */}
          <div className="space-y-4 pl-0">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🎬</span>
              <div>
                <p className="text-xs uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>Use Case I</p>
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>The Big Effect — Be Careful What You Wish For</h3>
              </div>
            </div>
            <p className="text-lg leading-relaxed opacity-80">
              In the film <em>Big</em>, a twelve-year-old boy wishes to be big — and wakes up to discover that the life he wanted isn&apos;t quite what he imagined. The magic isn&apos;t the wish. The magic is what the wish teaches him about the life he already had.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              Pandora&apos;s Box carries that same quiet gift. Step into the role of a king, and you might discover the loneliness at the top of the tower. Inhabit the life of someone with everything you think you want — and notice what you don&apos;t miss. Sometimes the fastest path to gratitude is the one that runs through someone else&apos;s door.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              The world you step into isn&apos;t an escape. It&apos;s a mirror.
            </p>
          </div>

          {/* Use Case 2 */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🧠</span>
              <div>
                <p className="text-xs uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>Use Case II</p>
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>The Training Ground — Practice Makes Presence</h3>
              </div>
            </div>
            <p className="text-lg leading-relaxed opacity-80">
              Athletes run the play in their minds before they run it on the field. Great speakers rehearse the room before they walk into it. Performers live the character before the curtain rises. Repetition builds presence. And presence is confidence in motion.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              Pandora&apos;s Box is the ultimate training ground for anything you want to get better at — navigating conflict, holding authority, leading under pressure, communicating with grace, staying grounded when the stakes are high. You can walk into a room as a general who has already fought the battle. You can negotiate as someone who has already lived the outcome.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              The reps you put in here don&apos;t disappear when you close the session. They live in your body. Your intuition. Your calm.
            </p>
          </div>

          {/* Use Case 3 */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-3xl">✨</span>
              <div>
                <p className="text-xs uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>Use Case III</p>
                <h3 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>The Inner Journey — Navigating Your Own Universe</h3>
              </div>
            </div>
            <p className="text-lg leading-relaxed opacity-80">
              There is a version of this that goes deeper than entertainment, deeper than training — into the territory of the soul itself.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              Immersive experience, when it&apos;s crafted with intention, becomes a vehicle for inner work. You can step into a mythic world that mirrors an emotional truth you&apos;re living. You can inhabit a figure — a healer, a wanderer, a sage — and discover something true about yourself through their eyes. The metaphor gives you distance. The distance gives you clarity.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              Joseph Campbell called it the Hero&apos;s Journey: a departure from the known, a descent into the unknown, and a return with something you couldn&apos;t have found without leaving. Pandora&apos;s Box is a door for that journey. Not outward. Inward. Toward the magic of life that has always existed within you — waiting to be remembered.
            </p>
          </div>

          {/* Founders */}
          <div className="space-y-8">
            <div className="space-y-2">
              <p className="text-sm uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>III. The People</p>
              <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
                The Founders
              </h2>
              <p className="text-lg leading-relaxed opacity-70">
                Two builders who took the question seriously enough to do something about it.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {/* Binny */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
              >
                <div className="aspect-[4/3] relative overflow-hidden">
                  <Image
                    src="/founders-binny.jpg"
                    alt="Binny Plotkin, Co-founder of Pandora's Box"
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-6 space-y-2">
                  <p className="text-xs uppercase tracking-widest opacity-50" style={{ fontFamily: "var(--font-mono)" }}>Co-founder</p>
                  <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Binny Plotkin</h3>
                  <p className="text-sm leading-relaxed opacity-70">
                    Builder, storyteller, and the person who looked at the question &ldquo;what does it feel like to be a king&rdquo; and said — let&apos;s find out. Binny is drawn to language, mythology, and the sacred inner journey of returning to the deepest self. He believes within each person lives a vast inner infinity, waiting to be remembered. His thesis: the best technology vanishes. What remains is the experience.
                  </p>
                </div>
              </div>

              {/* Josh */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
              >
                <div className="aspect-[4/3] relative overflow-hidden">
                  <Image
                    src="/founders-josh.jpg"
                    alt="Josh Sassoon, Co-founder of Pandora's Box"
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="p-6 space-y-2">
                  <p className="text-xs uppercase tracking-widest opacity-50" style={{ fontFamily: "var(--font-mono)" }}>Co-founder</p>
                  <h3 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>Josh Sassoon</h3>
                  <p className="text-sm leading-relaxed opacity-70">
                    The man with an uncanny instinct for finding the most interesting version of any idea and saying it out loud before anyone has the chance to overthink it. Josh has a rare ability to hold vision and execution simultaneously — to dream wildly and build precisely. Pandora&apos;s Box exists because he asked the question no one else thought to ask.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Why Now */}
          <div className="space-y-4">
            <p className="text-sm uppercase tracking-widest opacity-40" style={{ fontFamily: "var(--font-mono)" }}>IV. The Moment</p>
            <h2 className="text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              Why Now
            </h2>
            <p className="text-lg leading-relaxed opacity-80">
              The technology to do this well didn&apos;t exist until recently. Language models that can hold an entire world in memory, generate coherent consequence and dialogue, adapt to your choices in real time — all of that became possible in a window that spans roughly the last two years.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              The hunger for it is ancient. The tool is new. And we are standing at the exact moment where the two have finally met.
            </p>
            <p className="text-lg leading-relaxed opacity-80">
              The rock in Central Park was always there. It just took a while for the rest of the world to catch up to the conversation that happened on it.
            </p>
          </div>

          {/* CTA */}
          <div className="pt-8 text-center space-y-5 border-t" style={{ borderColor: "var(--border)" }}>
            <p className="text-lg opacity-60 italic">
              &ldquo;The privilege of a lifetime is being who you are.&rdquo;<br />
              <span className="text-sm not-italic opacity-40">— Joseph Campbell</span>
            </p>
            <p className="text-base opacity-60">
              And sometimes — the quickest path back to yourself is the one that leads somewhere else first.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full text-sm font-medium transition-all hover:scale-105 hover:opacity-90"
              style={{
                background: "var(--accent)",
                color: "#fff",
                fontFamily: "var(--font-mono)",
              }}
            >
              Open the Box →
            </Link>
          </div>

        </article>
      </section>
    </main>
  );
}
