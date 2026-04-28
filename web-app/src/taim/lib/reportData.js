// Builds the props object passed to SolarReportPDF from store state + pipeline output.

export function buildReportProps(storeState, pipelineData, selectedOfferName) {
  const { roofs, intake } = storeState;

  const totalArea = roofs.reduce((s, r) => s + (r.plane?.area ?? 0), 0);

  const intakeData = {
    name:        intake?.name ?? intake?.client ?? '—',
    email:       intake?.email ?? '—',
    address:     intake?.address ?? '—',
    postalCode:  intake?.postal ?? intake?.postalCode ?? '—',
    roofType:    intake?.roofType ?? 'pitched',
    roofArea:    totalArea > 0 ? parseFloat(totalArea.toFixed(1)) : Number(intake?.roofArea ?? 0),
    orientation: intake?.orientation ?? 'S',
    monthlyBill: Number(intake?.bill ?? intake?.monthlyBill ?? 0),
  };

  const data = selectedOfferName
    ? { ...pipelineData, selectedOfferName }
    : pipelineData;

  return { intake: intakeData, pipelineData: data };
}

export { buildReportProps as deriveReportData };
