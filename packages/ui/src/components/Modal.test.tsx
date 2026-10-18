import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeRoot } from '../theme';
import { Modal } from './Modal';

afterEach(cleanup);

const renderModal = (open: boolean) =>
  render(
    <ThemeRoot theme="dark">
      <Modal open={open} title="Ask someone to listen">
        <p>Body</p>
      </Modal>
    </ThemeRoot>,
  );

describe('Modal', () => {
  it('draws no veil while closed, so the page behind stays clickable', () => {
    renderModal(false);
    expect(document.querySelector('.au-modal-veil')).toBeNull();
    expect(document.querySelector('.au-modal')).toBeNull();
  });

  it('draws the veil and the pop-up while open', () => {
    renderModal(true);
    expect(document.querySelector('.au-modal-veil')).not.toBeNull();
    expect(document.querySelector('.au-modal')).not.toBeNull();
  });
});
