import { useId, useState } from "react";

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid: boolean;
  minLength?: number;
  hint?: string;
}

export function PasswordField({ value, onChange, autoComplete, invalid, minLength, hint }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="mi-login__field">
      <label htmlFor={id}>Password</label>
      <div className="mi-login__control">
        <input
          id={id}
          className="mi-login__input mi-login__input--toggle"
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="mi-textbtn mi-login__toggle"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mi-login__hint">
          {hint}
        </p>
      )}
    </div>
  );
}
