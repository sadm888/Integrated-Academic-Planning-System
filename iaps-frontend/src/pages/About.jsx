import React from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/About.css';

const About = () => {
  const navigate = useNavigate();

  return (
    <div className="about-container">
      <header className="about-header">
        <h1>About IAPS</h1>
        <button onClick={() => navigate('/dashboard')} className="btn-secondary">
          Back to Dashboard
        </button>
      </header>

      <main className="about-content">
        <section className="about-section">
          <h2>Integrated Academic Planning System</h2>
          <p className="intro">
            IAPS is a comprehensive academic platform designed to function as an
            academic operating system rather than a traditional college portal.
          </p>
        </section>

        <section className="about-section">
          <h2>Core Features</h2>
          <div className="features-grid">
            <div className="feature-card">
              <h3>📚 Session-Based Architecture</h3>
              <p>
                Complete semester history tracking with read-only archival and
                clean data separation for accurate CGPA computation.
              </p>
            </div>

            <div className="feature-card">
              <h3>👥 Multi-CR Management</h3>
              <p>
                Multiple Class Representatives with equal privileges, ensuring
                seamless collaboration and fail-safe operation.
              </p>
            </div>

            <div className="feature-card">
              <h3>📅 Smart Calendar Sync</h3>
              <p>
                Google Calendar integration with approval workflow to prevent
                unauthorized calendar pollution.
              </p>
            </div>

            <div className="feature-card">
              <h3>❓ Anonymous Doubt Room</h3>
              <p>
                Ask questions without fear of judgment while maintaining
                accountability through internal tracking.
              </p>
            </div>

            <div className="feature-card">
              <h3>📊 Analytics & Insights</h3>
              <p>
                Track marks, calculate required scores for target grades, and
                analyze performance across semesters.
              </p>
            </div>

            <div className="feature-card">
              <h3>🤖 AI-Ready Architecture</h3>
              <p>
                Built-in support for AI learning tools including flashcards,
                summaries, and intelligent document processing.
              </p>
            </div>
          </div>
        </section>

        <section className="about-section">
          <h2>Key Principles</h2>
          <ul className="principles-list">
            <li>
              <strong>Explicit Ownership & Permissions:</strong> Clear role-based
              access control with CR authority properly scoped per semester.
            </li>
            <li>
              <strong>One Active Academic Reality:</strong> Only one semester is
              active at a time, with full historical tracking.
            </li>
            <li>
              <strong>Separation of Concerns:</strong> Human workflows and AI
              capabilities are cleanly separated for optimal performance.
            </li>
            <li>
              <strong>Fail-Safe Defaults:</strong> System enforces at least one CR
              at all times and prevents destructive operations.
            </li>
          </ul>
        </section>

        <section className="about-section">
          <h2>Problems We Solve</h2>
          <ul className="problems-list">
            <li>Fragmented academic information across multiple platforms</li>
            <li>No historical tracking of semesters and academic progress</li>
            <li>Informal and error-prone Class Representative authority</li>
            <li>Calendar edits without proper consent</li>
            <li>Fear of asking doubts publicly in class</li>
            <li>Lack of analytics-driven academic planning</li>
            <li>Disconnected AI tools without actual course context</li>
          </ul>
        </section>

        <section className="about-section tech-stack">
          <h2>Technology Stack</h2>
          <div className="tech-grid">
            <div className="tech-category">
              <h3>Frontend</h3>
              <ul>
                <li>React</li>
                <li>React Router</li>
                <li>Axios</li>
                <li>Chart.js / Recharts</li>
              </ul>
            </div>
            <div className="tech-category">
              <h3>Backend</h3>
              <ul>
                <li>Flask (Python)</li>
                <li>JWT Authentication</li>
                <li>Flask-Mail</li>
                <li>RESTful APIs</li>
              </ul>
            </div>
            <div className="tech-category">
              <h3>Database</h3>
              <ul>
                <li>MongoDB</li>
                <li>Atlas-ready</li>
                <li>Explicit collections</li>
                <li>Optimized indexing</li>
              </ul>
            </div>
            <div className="tech-category">
              <h3>Security</h3>
              <ul>
                <li>HTTP-only cookies</li>
                <li>Email verification</li>
                <li>Role-based access</li>
                <li>OAuth 2.0</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="about-section version-info">
          <h2>Version Information</h2>
          <p><strong>Current Phase:</strong> Phase 1 - Foundation</p>
          <p><strong>Version:</strong> 1.0.0</p>
          <p><strong>Release Date:</strong> January 2026</p>
        </section>
      </main>
    </div>
  );
};

export default About;