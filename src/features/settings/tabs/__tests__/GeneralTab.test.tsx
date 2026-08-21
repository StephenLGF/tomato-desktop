import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTING } from '@/context/SettingsContext';
import GeneralTab from '../GeneralTab';

const setTheme = vi.fn();

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue || key,
  }),
}));

describe('GeneralTab', () => {
  it('shows the explicit theme selector', () => {
    render(
      <GeneralTab
        localLanguage="en"
        onChange={vi.fn()}
        localDisplay={DEFAULT_SETTING.display}
        onDisplaySettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Theme')).toHaveTextContent('Light');
  });

  it('rerenders when tool detail level changes', () => {
    const onChange = vi.fn();
    const onDisplaySettingsChange = vi.fn();

    const { rerender } = render(
      <GeneralTab
        localLanguage="en"
        onChange={onChange}
        localDisplay={DEFAULT_SETTING.display}
        onDisplaySettingsChange={onDisplaySettingsChange}
      />,
    );

    expect(
      screen.getByLabelText('Tool Detail Level'),
    ).toHaveTextContent('Simple (tool name only)');

    rerender(
      <GeneralTab
        localLanguage="en"
        onChange={onChange}
        localDisplay={{
          ...DEFAULT_SETTING.display,
          toolDetailLevel: 'developer',
        }}
        onDisplaySettingsChange={onDisplaySettingsChange}
      />,
    );

    expect(
      screen.getByLabelText('Tool Detail Level'),
    ).toHaveTextContent('Developer (params, errors, timing)');
  });
});
