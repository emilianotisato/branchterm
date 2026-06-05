interface Props {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExitConfirmModal({ onConfirm, onCancel }: Props) {
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onCancel();
  }

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className="modal exit-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Quit branchterm?</span>
          <button className="btn-icon" style={{ opacity: 1 }} onClick={onCancel}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="exit-confirm-message">
            Running terminals will be closed. Unsaved shell output is lost; app state is saved.
          </p>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={onConfirm}>
              Quit
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
