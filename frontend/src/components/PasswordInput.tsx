import { useState, type InputHTMLAttributes } from "react";
import { EyeIcon, EyeOffIcon } from "./TxnIcons";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "aria-label"> {
  /** Accessible name for the input. Needed because the wrapping <label> would otherwise
   *  also absorb the toggle button's name ("Password Show password"). */
  label: string;
}

/** Password field with an inline show/hide toggle. Pass the usual input props through. */
export function PasswordInput({ label, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-input">
      <input {...props} aria-label={label} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="password-input__toggle"
        aria-label="Show password"
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
      </button>
    </span>
  );
}
