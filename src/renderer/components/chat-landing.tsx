import { BookOpen, Code2, Orbit, Terminal } from 'lucide-react';
import type { LandingSettings } from '../../shared/landing';

const icons = { code: Code2, book: BookOpen, terminal: Terminal };
export function ChatLanding({
  landing,
  onSelect,
}: {
  landing: LandingSettings;
  onSelect: (text: string) => void;
}) {
  return (
    <div className="chat-welcome">
      <div className="welcome-mark">
        {landing.logo ? (
          <img src={landing.logo} alt="Landing logo" />
        ) : (
          <Orbit size={38} strokeWidth={1.2} />
        )}
      </div>
      {landing.eyebrow && <div className="eyebrow">{landing.eyebrow}</div>}
      <h1>{landing.title}</h1>
      {landing.description && <p className="landing-description">{landing.description}</p>}
      <div className="suggestions">
        {landing.suggestions.map((suggestion, index) => {
          const Icon = icons[suggestion.icon];
          return (
            <button type="button" key={index} onClick={() => onSelect(suggestion.text)}>
              <Icon size={19} />
              <strong>{suggestion.title}</strong>
              <span>{suggestion.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
