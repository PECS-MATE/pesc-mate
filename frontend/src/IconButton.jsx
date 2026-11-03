import { forwardRef } from 'react';
import UiIcon from './UiIcon';

// Keep visible toolbars concise without removing the control's accessible name.
const IconButton = forwardRef(function IconButton({ icon, label, className = '', type = 'button', size = 24, children, ...props }, ref) {
  return <button {...props} ref={ref} type={type} className={`icon-action ${className}`.trim()}
    aria-label={label} title={label}>
    <UiIcon name={icon} size={size} />{children}
  </button>;
});

export default IconButton;
