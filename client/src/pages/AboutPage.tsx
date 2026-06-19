import { BookOpen, FileText, LayoutTemplate, ClipboardCheck, MessageSquare, Bot, GitCommit } from 'lucide-react'

export function AboutPage() {
  return (
    <div className="page-content" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <h1>About &amp; Help</h1>
        <p className="text-muted">Learn how to use the Progress Report Tool and the Progress Bot Slack integration.</p>
      </div>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Getting Started</h2>
        <p>
          The Progress Report Tool helps instructors track student attendance, write progress reviews,
          and stay compliant with reporting requirements — all in one place.
        </p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Core Features</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <FeatureCard
            Icon={BookOpen}
            title="Dashboard"
            description="See your assigned students, their attendance status, and how many reviews are pending. This is your home base."
          />
          <FeatureCard
            Icon={FileText}
            title="Reviews"
            description="Write and submit monthly progress reviews for your students. Open a student's review, apply a template, and save your draft. Use the Generate from GitHub button to auto-draft a review from the student's recent commit activity — Claude reads their code history and writes the paragraphs for you."
          />
          <FeatureCard
            Icon={LayoutTemplate}
            title="Templates"
            description="Create reusable review templates so you don't start from scratch each session. Templates can be applied when opening a new review."
          />
          <FeatureCard
            Icon={ClipboardCheck}
            title="Check-in"
            description="Mark student attendance at the start of each class session. Check-ins feed into compliance and volunteer-hour reports."
          />
          <FeatureCard
            Icon={GitCommit}
            title="GitHub Draft Generation"
            description="In the review editor, click Generate from GitHub to have Claude read the student's recent commits and write a full progress review draft. If your template uses {{progress}}, {{highlights}}, or {{instructorNotes}} placeholders, Claude fills only those sections and leaves the rest of your template intact."
          />
          <FeatureCard
            Icon={MessageSquare}
            title="Feedback"
            description="Every progress review sent to a guardian includes a star-rating feedback link and a parent satisfaction survey link. Responses appear in the Feedback tab so you can track guardian engagement."
          />
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>
          <Bot size={16} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
          Progress Bot — Slack Integration
        </h2>
        <p style={{ marginBottom: '0.75rem' }}>
          <strong>Progress Bot</strong> is a Claude-powered assistant that lives in your Slack workspace.
          It pulls a student's recent GitHub commits, has Claude write a full progress review draft,
          and lets you approve or edit it — all without opening a browser.
        </p>

        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>How to use it</h3>
        <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.8 }}>
          <li>Open Slack and find the <strong>#progress-bot</strong> channel (or DM Progress Bot directly).</li>
          <li>
            Ask it to generate a review by mentioning the student's name or GitHub username, for example:
            <blockquote style={{
              background: 'var(--color-surface-2, #f5f5f5)',
              borderLeft: '3px solid var(--color-primary, #4f46e5)',
              margin: '0.5rem 0',
              padding: '0.5rem 0.75rem',
              borderRadius: '0 4px 4px 0',
              fontStyle: 'italic',
            }}>
              "Generate a review for @maria_garcia"
            </blockquote>
          </li>
          <li>Progress Bot fetches the student's GitHub commits for the review's selected month and Claude writes a full draft — including progress, highlights, and instructor notes.</li>
          <li>The draft is posted with <strong>Approve</strong> and <strong>Edit</strong> buttons.</li>
          <li>Click <strong>Approve</strong> to save the review to the Progress Report Tool, or <strong>Edit</strong> to tweak the text first.</li>
        </ol>

        <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.5rem' }}>Tips</h3>
        <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.8 }}>
          <li>The bot looks for commits in League curriculum repos (e.g. Level1-Module0, Python-Apprentice) and filters out personal or unrelated repos automatically.</li>
          <li>If a student has no GitHub activity in the selected month, the bot will let you know so you can write the review manually.</li>
          <li>Reviews posted via Slack show up immediately in the Reviews tab here.</li>
          <li>You can also generate drafts directly in the browser using the <strong>Generate from GitHub</strong> button in any review editor.</li>
        </ul>
      </section>

      <section>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Need help?</h2>
        <p>
          Contact your program administrator or reach out in the Slack <strong>#instructors</strong> channel
          for support with this tool.
        </p>
      </section>
    </div>
  )
}

interface FeatureCardProps {
  Icon: React.ElementType
  title: string
  description: string
}

function FeatureCard({ Icon, title, description }: FeatureCardProps) {
  return (
    <div style={{
      display: 'flex',
      gap: '0.75rem',
      padding: '0.875rem 1rem',
      background: 'var(--color-surface-2, #f9f9f9)',
      borderRadius: 8,
      border: '1px solid var(--color-border, #e5e5e5)',
    }}>
      <Icon size={18} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-primary, #4f46e5)' }} />
      <div>
        <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{title}</div>
        <div style={{ fontSize: '0.875rem', color: 'var(--color-muted, #666)' }}>{description}</div>
      </div>
    </div>
  )
}
