// Lazy-loaded PDF generation — dynamically imported inside click handlers
// so @react-pdf/renderer never runs during SSR.

import React from 'react';
import { pdf } from '@react-pdf/renderer';
import SolarReportPDF from '../components/SolarReportPDF';
import { buildReportProps } from './reportData';
import { callPipeline } from './pipelineClient';

export async function generateReport(storeState, screenshot = null) {
  const pipelineData = await callPipeline(storeState);
  const props        = buildReportProps(storeState, pipelineData);
  const blob         = await pdf(React.createElement(SolarReportPDF, { ...props, screenshot })).toBlob();
  return blob;
}
