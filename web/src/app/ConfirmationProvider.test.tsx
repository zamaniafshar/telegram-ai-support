// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfirmationProvider, useConfirmation } from './ConfirmationProvider';

afterEach(cleanup);

function ConfirmationHarness() {
  const confirm = useConfirmation();

  return (
    <button
      type="button"
      onClick={async () => {
        const accepted = await confirm({
          title: 'حذف دسترسی',
          message: 'این دسترسی حذف شود؟',
          confirmLabel: 'حذف',
          tone: 'danger',
        });
        document.body.dataset.confirmed = String(accepted);
      }}
    >
      نمایش تأیید
    </button>
  );
}

describe('in-app confirmation dialog', () => {
  it('shows at the top and resolves true when confirmed', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmationProvider>
        <ConfirmationHarness />
      </ConfirmationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'نمایش تأیید' }));

    const dialog = screen.getByRole('dialog', { name: 'حذف دسترسی' });
    expect(dialog).toHaveClass('sheet-top');
    expect(dialog.parentElement).toHaveClass('sheet-backdrop-top');

    await user.click(screen.getByRole('button', { name: 'حذف' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.dataset.confirmed).toBe('true');
  });

  it('resolves false when dismissed with Escape', async () => {
    const user = userEvent.setup();
    render(
      <ConfirmationProvider>
        <ConfirmationHarness />
      </ConfirmationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'نمایش تأیید' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.dataset.confirmed).toBe('false');
  });
});
