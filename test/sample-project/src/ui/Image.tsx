interface ImageProps {
  src: string;
  alt: string;
  size?: number;
}

export function Image({ src, alt, size = 40 }: ImageProps) {
  return <img src={src} alt={alt} width={size} height={size} />;
}
