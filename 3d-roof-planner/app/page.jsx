'use client';
import dynamic from 'next/dynamic';
const SolarPlanner = dynamic(() => import('@/components/SolarPlanner'), { ssr: false });
export default function Page() { return <SolarPlanner />; }
