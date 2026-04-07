import { useState } from 'react';

export type ModalType = 'none' | 'item' | 'scan' | 'settings';

export function useModals() {
  const [activeModal, setActiveModal] = useState<ModalType>('none');
  
  const open = (modal: ModalType) => setActiveModal(modal);
  const close = () => setActiveModal('none');

  // Layered Esc: close innermost modal
  const handleEsc = (croppingActive: boolean) => {
    if (croppingActive) return; // handled in cropper component
    if (activeModal !== 'none') {
      close();
    }
  };

  return { activeModal, open, close, handleEsc };
}
