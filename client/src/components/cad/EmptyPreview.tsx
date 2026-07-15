export function EmptyPreview() {
  return (
    <group>
      <mesh>
        <boxGeometry args={[4, 2.5, 0.3]} />
        <meshBasicMaterial
          color={0x00ffcc}
          wireframe
          transparent
          opacity={0.22}
        />
      </mesh>
      <mesh position={[0, 0.2, 1]}>
        <torusGeometry args={[1, 0.12, 18, 64]} />
        <meshBasicMaterial
          color={0x2ea3ff}
          wireframe
          transparent
          opacity={0.16}
        />
      </mesh>
    </group>
  );
}
