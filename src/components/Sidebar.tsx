interface Props {
  activeBranch: string | null;
  onSelectBranch: (branch: string) => void;
}

export function Sidebar({ activeBranch: _activeBranch, onSelectBranch: _onSelectBranch }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>branchterm</span>
      </div>
      <div className="branches-list">
        <div className="empty-state">No branches</div>
      </div>
      <div className="sidebar-footer">
        <button className="btn btn-primary">+ New Branch</button>
      </div>
    </div>
  );
}
