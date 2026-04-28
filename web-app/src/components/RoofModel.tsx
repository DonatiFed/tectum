import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Environment, ContactShadows, OrbitControls, Html } from '@react-three/drei';

function Model() {
  return (
    <group position={[0, -2, 0]}>
      {/* House base */}
      <mesh castShadow receiveShadow position={[0, 2, 0]}>
        <boxGeometry args={[6, 4, 8]} />
        <meshStandardMaterial color="#EBE8E1" />
      </mesh>
      {/* Roof */}
      <mesh castShadow receiveShadow position={[0, 4.8, 0]} rotation={[0, Math.PI / 4, 0]}>
        {/* Using a pyramid style roof using a cone or cylinder */}
        <cylinderGeometry args={[0, 5.6, 2, 4]} />
        <meshStandardMaterial color="#2D3777" />
      </mesh>
      {/* Solar Panel Indicator */}
      <mesh castShadow receiveShadow position={[0, 5, -1.5]} rotation={[Math.PI / 6, 0, 0]}>
        <boxGeometry args={[4, 0.1, 3]} />
        <meshStandardMaterial color="#1A1A2E" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  );
}

function Spinner() {
  return (
    <Html center>
      <div className="text-sm font-medium text-foreground bg-white/80 backdrop-blur px-4 py-2 rounded-full shadow-sm whitespace-nowrap">
        Loading 3D model…
      </div>
    </Html>
  );
}

export function RoofModel() {
  return (
    <Canvas shadows camera={{ position: [12, 10, 14], fov: 38 }} className="!bg-gradient-sky">
      <ambientLight intensity={0.55} />
      <directionalLight 
        position={[8, 14, 6]} 
        intensity={1.4} 
        castShadow 
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15} 
        shadow-camera-right={15}
        shadow-camera-top={15} 
        shadow-camera-bottom={-15}
      />
      
      <Suspense fallback={<Spinner />}>
        <Model />
        <Environment preset="city" />
      </Suspense>
      
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={30} blur={2.4} far={10} />
      <OrbitControls 
        enablePan={false} 
        minDistance={8} 
        maxDistance={30}
        maxPolarAngle={Math.PI / 2.1} 
        autoRotate 
        autoRotateSpeed={0.4} 
      />
    </Canvas>
  );
}
