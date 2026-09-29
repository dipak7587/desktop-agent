import { useRef, useState } from 'react';
import { Eye } from 'lucide-react';
import { landingSchema, type LandingSettings } from '../../shared/landing';
import { ChatLanding } from '../components/chat-landing';
import { Modal } from '../components/common';
import { attempt } from '../stores';

export function LandingEditor({
  value,
  onChange,
  onSave,
}: {
  value: LandingSettings;
  onChange: (value: LandingSettings) => void;
  onSave: (value: LandingSettings) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [readingLogo, setReadingLogo] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const latestValue = useRef(value);
  latestValue.current = value;
  const update = (change: Partial<LandingSettings>) =>
    onChange({ ...latestValue.current, ...change });
  return (
    <>
      <form
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void attempt(async () => {
          try {
            await onSave(landingSchema.parse(value));
          } finally {
            setBusy(false);
          }
        });
      }}
    >
      <section className="settings-section landing-settings-row">
        <div className="landing-settings-heading">
          <h2>Landing</h2>
          <p>Customize the welcome screen shown in an empty chat.</p>
        </div>
        <div className="settings-fields">
          <label>
            Welcome label
            <input
              maxLength={100}
              value={value.eyebrow}
              onChange={(e) => update({ eyebrow: e.target.value })}
            />
          </label>
          <label>
            Welcome heading
            <input
              required
              maxLength={160}
              value={value.title}
              onChange={(e) => update({ title: e.target.value })}
            />
          </label>
          <label>
            Welcome description
            <textarea
              rows={3}
              maxLength={1000}
              value={value.description}
              onChange={(e) => update({ description: e.target.value })}
            />
          </label>
          <label>
            Landing logo
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={readingLogo || busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setReadingLogo(true);
                void attempt(async () => {
                  try {
                    if (
                      file.size > 1_048_576 ||
                      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                    )
                      throw new Error('Choose a PNG, JPEG, or WebP logo up to 1 MB.');
                    const logo = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result));
                      reader.onerror = () => reject(new Error('Could not read the logo.'));
                      reader.readAsDataURL(file);
                    });
                    const image = new Image();
                    image.src = logo;
                    await image.decode();
                    update({ logo });
                  } finally {
                    setReadingLogo(false);
                  }
                });
              }}
            />
          </label>
          <p className="small muted">
            PNG, JPEG, or WebP, up to 1 MB. Stored locally with your settings.
          </p>
          {value.logo && (
            <button
              type="button"
              disabled={readingLogo || busy}
              onClick={() => update({ logo: '' })}
            >
              Remove logo
            </button>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={busy || readingLogo}
              onClick={() => onChange(landingSchema.parse({}))}
            >
              Reset landing to defaults
            </button>
            <button type="button" onClick={() => setShowPreview(true)}>
              <Eye size={14} /> Preview
            </button>
            <button className="primary" disabled={busy || readingLogo}>
              {busy ? 'Saving…' : 'Save landing'}
            </button>
          </div>
        </div>
      </section>
      {value.suggestions.map((suggestion, index) => (
        <section className="settings-section landing-settings-row" key={index}>
          <div className="landing-settings-heading">
            <h3>Suggestion {index + 1}</h3>
            <p>Customize the title, prompt, and icon for this chat suggestion.</p>
          </div>
          <div className="settings-fields">
            <label>
              Title
              <input
                required
                maxLength={80}
                value={suggestion.title}
                onChange={(e) =>
                  update({
                    suggestions: value.suggestions.map((item, i) =>
                      i === index ? { ...item, title: e.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              Prompt
              <textarea
                required
                maxLength={1000}
                rows={3}
                value={suggestion.text}
                onChange={(e) =>
                  update({
                    suggestions: value.suggestions.map((item, i) =>
                      i === index ? { ...item, text: e.target.value } : item,
                    ),
                  })
                }
              />
            </label>
            <label>
              Icon
              <select
                value={suggestion.icon}
                onChange={(e) =>
                  update({
                    suggestions: value.suggestions.map((item, i) =>
                      i === index ? { ...item, icon: e.target.value as typeof item.icon } : item,
                    ),
                  })
                }
              >
                <option value="code">Code</option>
                <option value="book">Book</option>
                <option value="terminal">Terminal</option>
              </select>
            </label>
          </div>
        </section>
      ))}
      <p className="small muted">
        Each card displays its prompt and inserts it into Chat when clicked.
      </p>
      </form>
      {showPreview && (
        <Modal wide title="Landing preview" onClose={() => setShowPreview(false)}>
          <ChatLanding landing={value} onSelect={() => {}} />
        </Modal>
      )}
    </>
  );
}
