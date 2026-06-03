interface Props {
  activeBranch: string | null;
}

export function MainArea({ activeBranch }: Props) {
  return (
    <div className="main-area">
      {activeBranch ? (
        <div className="placeholder">Terminal for {activeBranch} (coming soon)</div>
      ) : (
        <div className="placeholder">Select a branch to open a terminal</div>
      )}
    </div>
  );
}
