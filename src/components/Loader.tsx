interface LoaderProps {
  label?: string;
  large?: boolean;
}

export function Loader({ label, large }: LoaderProps) {
  return (
    <div className="loader-block">
      <div className={'spinner' + (large ? ' lg' : '')} aria-hidden />
      {label && <div>{label}</div>}
    </div>
  );
}
