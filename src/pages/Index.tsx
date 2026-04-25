import React, { useState } from 'react';
import { Intake } from '../components/Intake';
import { Planner } from '../components/Planner';
import { type IntakeData } from '../lib/solar';

export default function Index() {
  const [intake, setIntake] = useState<IntakeData | null>(null);
  
  if (!intake) return <Intake onComplete={setIntake} />;
  return <Planner intake={intake} onBack={() => setIntake(null)} />;
}
