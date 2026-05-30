import { BookOpen, FileText, LayoutTemplate, ClipboardCheck, MessageSquare, Bot, ChevronRight } from 'lucide-react'

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
            description="Write and submit progress reviews for your students. Open a student's review, fill in the form, and submit it when ready. Drafted reviews are saved automatically."
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
            Icon={MessageSquare}
            title="Feedback"
            description="Students and guardians can submit feedback after sessions. You can view feedback submitted for your students from the Feedback link."
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
          It lets you generate and post student progress reviews without ever opening a browser.
        </p>

        <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>How to use it</h3>
        <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.8 }}>
          <li>Open Slack and find the <strong>#progress-bot</strong> channel (or DM Progress Bot directly).</li>
          <li>
            Ask it to generate a review in plain English, for example:
            <blockquote style={{
              background: 'var(--color-surface-2, #f5f5f5)',
              borderLeft: '3px solid var(--color-primary, #4f46e5)',
              margin: '0.5rem 0',
              padding: '0.5rem 0.75rem',
              borderRadius: '0 4px 4px 0',
              fontStyle: 'italic',
            }}>
              "Write a review for Maria Garcia — she improved her Python skills this week but struggled with loops."
            </blockquote>
          </li>
          <li>Progress Bot drafts the review and posts it with <strong>Approve</strong> and <strong>Edit</strong> buttons.</li>
          <li>Click <strong>Approve</strong> to post the review directly to the Progress Report Tool, or <strong>Edit</strong> to tweak the text first.</li>
        </ol>

        <h3 style={{ fontSize: '0.95rem', margin: '1rem 0 0.5rem' }}>Tips</h3>
        <ul style={{ paddingLeft: '1.25rem', lineHeight: 1.8 }}>
          <li>You can mention multiple students in one message and the bot will draft a review per student.</li>
          <li>The bot understands context — if you say "same as last week but she finished the project," it uses prior review tone as a reference.</li>
          <li>Reviews posted via Slack show up immediately in the Reviews tab here.</li>
          <li>If a student isn't found, the bot will ask you to confirm the name before proceeding.</li>
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
