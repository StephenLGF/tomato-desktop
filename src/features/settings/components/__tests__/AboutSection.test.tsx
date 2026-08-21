import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { describe, expect, it, vi } from 'vitest';

import { AboutSection } from '../AboutSection';

const updateState = vi.hoisted(() => ({
  status: 'available' as const,
  availableVersion: '1.0.0',
  downloadProgress: 0,
  error: null,
  checkForUpdate: vi.fn(),
}));

vi.mock('@/context/UpdateContext', () => ({
  useUpdateContext: () => updateState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback || key,
  }),
}));

describe('AboutSection', () => {
  it('does not expose in-app update installation', () => {
    render(<AboutSection />);

    expect(screen.getByText('v{{version}} available')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Install Update' }),
    ).not.toBeInTheDocument();
  });
});
