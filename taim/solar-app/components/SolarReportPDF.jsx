import React from 'react';
import { Document, Page, Text, View, StyleSheet, Svg, Circle, Rect, Image } from '@react-pdf/renderer';

const C = {
  green:       '#1a5c35',
  greenMid:    '#2e7d52',
  greenLight:  '#e6f4ec',
  greenAccent: '#52b77a',
  white:       '#ffffff',
  grayDark:    '#2c2c2c',
  gray:        '#6b7c73',
  grayLight:   '#9aab9f',
  border:      '#dce8e1',
  bg:          '#f4f9f6',
  blue:        '#1e3a5f',
  blueMid:     '#2d5fa8',
  blueLight:   '#e8f0fb',
};
const B = 'Helvetica-Bold';
const R = 'Helvetica';

const today  = new Date().toLocaleDateString('de-DE');
const fmtN   = (n, dec = 0) => Number(n ?? 0).toFixed(dec);
const fmtEUR = (n) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n ?? 0);
const pct    = (v) => `${Math.round((v ?? 0) * 100)}%`;

// ── Shared primitives ──────────────────────────────────────────────────
function Footer() {
  return (
    <View style={sh.footer} fixed>
      <Text style={sh.footerL}>Solar Installation Report  ·  Confidential</Text>
      <Text style={sh.footerR} render={({ pageNumber }) => `Page ${pageNumber}`} />
    </View>
  );
}

function PageHeader({ section, title }) {
  return (
    <View style={sh.pageHeader} fixed>
      <View>
        <Text style={sh.pageHeaderSection}>{section}</Text>
        <Text style={sh.pageHeaderTitle}>{title}</Text>
      </View>
      <Text style={sh.pageHeaderDate}>{today}</Text>
    </View>
  );
}

function SubTitle({ children }) {
  return (
    <View style={sh.subTitleWrap}>
      <Text style={sh.subTitle}>{children}</Text>
    </View>
  );
}

function Field({ label, value, full = false }) {
  return (
    <View style={full ? sh.lvFull : sh.lv}>
      <Text style={sh.lbl}>{label}</Text>
      <Text style={sh.val}>{value ?? '—'}</Text>
    </View>
  );
}

// ── Page 1: Cover ──────────────────────────────────────────────────────
function CoverPage({ intake, screenshot }) {
  return (
    <Page size="A4" style={sh.coverPage}>
      <View style={sh.coverTop}>
        <Svg style={sh.coverSvg} viewBox="0 0 595 480">
          <Rect x="0" y="0" width="595" height="480" fill={C.green} />
          <Circle cx="520" cy="90"  r="190" fill={C.greenMid}    opacity="0.45" />
          <Circle cx="-20" cy="430" r="140" fill={C.greenMid}    opacity="0.35" />
          <Circle cx="280" cy="500" r="240" fill={C.greenAccent} opacity="0.12" />
        </Svg>
        {screenshot && (
          <Image src={screenshot} style={sh.coverScreenshot} />
        )}
        <View style={sh.coverTitleBlock}>
          <Text style={sh.coverEyebrow}>TECHNICAL REPORT</Text>
          <Text style={sh.coverTitle}>Solar Installation</Text>
          <Text style={sh.coverTitle}>Report</Text>
          <View style={sh.coverAccentLine} />
        </View>
      </View>

      <View style={sh.coverBottom}>
        <View style={sh.coverMetaGrid}>
          <CoverMeta label="Client"      value={intake.name} />
          <CoverMeta label="Address"     value={intake.address} />
          <CoverMeta label="Postcode"    value={intake.postalCode} />
          <CoverMeta label="Generated"   value={today} />
          <CoverMeta label="Roof type"   value={intake.roofType} />
          <CoverMeta label="Roof area"   value={`${intake.roofArea} m²`} />
        </View>
      </View>

      <View style={sh.coverStripe}>
        <Text style={sh.coverStripeText}>Confidential  ·  For Client Use Only</Text>
      </View>
    </Page>
  );
}

function CoverMeta({ label, value }) {
  return (
    <View style={sh.coverMetaItem}>
      <Text style={sh.coverMetaLabel}>{label}</Text>
      <Text style={sh.coverMetaValue}>{value || '—'}</Text>
    </View>
  );
}

// ── Page 2: System & Energy ────────────────────────────────────────────
function EnergyPage({ intake, pipelineData }) {
  const offers  = pipelineData?.offers ?? [];
  const rec     = offers.find(o => o.option_name === 'Balanced') ?? offers[0];
  const ctx     = pipelineData?.project_context ?? {};

  const sizing  = rec?.sizing   ?? {};
  const metrics = rec?.metrics  ?? {};

  const kpis = [
    { val: fmtN(sizing.kwp, 2),                                      lbl: 'System Size\n(kWp)' },
    { val: sizing.battery_kwh > 0 ? fmtN(sizing.battery_kwh, 0) : '—', lbl: 'Battery\n(kWh)' },
    { val: Math.round(metrics.production_kwh ?? 0).toLocaleString('de-DE'), lbl: 'Annual Yield\n(kWh)' },
    { val: pct(metrics.self_sufficiency_rate),                        lbl: 'Self\nSufficiency' },
  ];

  return (
    <Page size="A4" style={sh.contentPage}>
      <PageHeader section="Section 01" title="Proposed System — Energy Details" />
      <View style={sh.pageBody}>

        {/* Recommendation badge */}
        {rec && (
          <View style={sh.recBadge}>
            <Text style={sh.recBadgeText}>
              Recommended option: {rec.option_name}  ·  {sizing.brand ?? '—'}
            </Text>
          </View>
        )}

        <View style={sh.kpiRow}>
          {kpis.map((k, i) => (
            <View key={i} style={i === kpis.length - 1 ? sh.kpiLast : sh.kpiItem}>
              <Text style={sh.kpiVal}>{k.val}</Text>
              <Text style={sh.kpiLbl}>{k.lbl}</Text>
            </View>
          ))}
        </View>

        <SubTitle>Property Details</SubTitle>
        <View style={sh.grid}>
          <Field label="Address"      value={intake.address}    full />
          <Field label="Postcode"     value={intake.postalCode} />
          <Field label="Roof type"    value={intake.roofType} />
          <Field label="Roof area"    value={`${intake.roofArea} m²`} />
          <Field label="Orientation"  value={intake.orientation} />
          <Field label="Monthly bill" value={`${intake.monthlyBill} €`} />
          <Field label="Annual demand" value={`${Math.round(ctx.effective_demand_kwh ?? 0).toLocaleString('de-DE')} kWh`} />
          <Field label="EV"           value={ctx.has_ev ? 'Yes' : 'No'} />
          <Field label="Heat pump"    value={sizing.heatpump_kw ? `${sizing.heatpump_kw} kW` : 'Not included'} />
        </View>

        <SubTitle>Proposed System</SubTitle>
        <View style={sh.grid}>
          <Field label="Solar modules"   value={`${sizing.modules ?? '—'} modules`} />
          <Field label="System size"     value={`${fmtN(sizing.kwp, 2)} kWp`} />
          <Field label="Brand"           value={sizing.brand ?? '—'} />
          <Field label="Battery storage" value={sizing.battery_kwh > 0 ? `${sizing.battery_kwh} kWh` : 'Not included'} />
          <Field label="EV wallbox"      value={sizing.wallbox ? 'Included' : 'Not included'} />
          <Field label="Heat pump"       value={sizing.heatpump_kw ? `${sizing.heatpump_kw} kW` : 'Not included'} />
        </View>

        <SubTitle>Yield Estimates</SubTitle>
        <View style={sh.grid}>
          <Field label="Annual production"  value={`${Math.round(metrics.production_kwh ?? 0).toLocaleString('de-DE')} kWh`} />
          <Field label="Self consumption"   value={pct(metrics.self_consumption_rate)} />
          <Field label="Self sufficiency"   value={pct(metrics.self_sufficiency_rate)} />
          <Field label="Total demand"       value={`${Math.round(metrics.total_demand_kwh ?? 0).toLocaleString('de-DE')} kWh`} />
        </View>
      </View>
      <Footer />
    </Page>
  );
}

// ── Page 3: Economic Analysis ──────────────────────────────────────────
function EconomicPage({ pipelineData }) {
  const offers = pipelineData?.offers ?? [];
  const rec    = offers.find(o => o.option_name === 'Balanced') ?? offers[0];
  const metrics = rec?.metrics ?? {};
  const bom     = rec?.bom     ?? [];

  return (
    <Page size="A4" style={sh.contentPage}>
      <PageHeader section="Section 02" title="Economic Analysis" />
      <View style={sh.pageBody}>

        {/* 3-offer comparison */}
        {offers.length > 0 && (
          <>
            <SubTitle>Options Comparison</SubTitle>
            <View style={sh.offerRow}>
              {offers.map((o, i) => (
                <OfferCard key={i} offer={o} isRec={o.option_name === (rec?.option_name)} />
              ))}
            </View>
          </>
        )}

        {/* Recommended offer economics */}
        <View style={sh.ecoCardRow}>
          <EcoCard title="Total Cost"      value={fmtEUR(metrics.total_cost_eur)}    unit="incl. installation" />
          <EcoCard title="Annual Savings"  value={fmtEUR(metrics.year1_savings_eur)} unit="year 1 estimate" />
          <EcoCard title="Payback Period"  value={`${fmtN(metrics.payback_years, 1)} y`} unit="estimated" />
          <EcoCard title="20-yr NPV"       value={fmtEUR(metrics.npv_20yr)}          unit="net present value" />
        </View>

        {/* Bill of Materials */}
        {bom.length > 0 && (
          <>
            <SubTitle>Bill of Materials — {rec?.option_name ?? 'Recommended'}</SubTitle>
            <View style={sh.tHead}>
              <Text style={[sh.tHc, { flex: 4 }]}>Component</Text>
              <Text style={[sh.tHc, { flex: 1, textAlign: 'center' }]}>Qty</Text>
            </View>
            {bom.map((item, i) => (
              <View key={i} style={[sh.tRow, i % 2 === 1 && sh.tRowAlt]}>
                <View style={{ flex: 4 }}>
                  <Text style={sh.tCell}>{item.component_name}</Text>
                  {item.component_brand && (
                    <Text style={[sh.tCell, { color: C.gray, fontSize: 7 }]}>{item.component_brand}</Text>
                  )}
                </View>
                <Text style={[sh.tCell, { flex: 1, textAlign: 'center' }]}>
                  {Number.isInteger(item.quantity) ? item.quantity : Number(item.quantity).toFixed(1)}
                </Text>
              </View>
            ))}
          </>
        )}

      </View>
      <Footer />
    </Page>
  );
}

function OfferCard({ offer, isRec }) {
  const s = offer.sizing  ?? {};
  const m = offer.metrics ?? {};
  return (
    <View style={[sh.offerCard, isRec && sh.offerCardRec]}>
      <Text style={[sh.offerCardTitle, isRec && { color: C.white }]}>{offer.option_name}</Text>
      {isRec && <Text style={sh.offerRecLabel}>Recommended</Text>}
      <View style={{ marginTop: 6, gap: 3 }}>
        <OfferRow label="Size"     value={`${fmtN(s.kwp, 1)} kWp`}       rec={isRec} />
        <OfferRow label="Battery"  value={s.battery_kwh > 0 ? `${s.battery_kwh} kWh` : '—'} rec={isRec} />
        <OfferRow label="Brand"    value={s.brand ?? '—'}                  rec={isRec} />
        <OfferRow label="Cost"     value={fmtEUR(m.total_cost_eur)}        rec={isRec} bold />
        <OfferRow label="Savings"  value={`${fmtEUR(m.year1_savings_eur)}/yr`} rec={isRec} />
        <OfferRow label="Payback"  value={`${fmtN(m.payback_years, 1)} y`} rec={isRec} />
        <OfferRow label="Self-suff" value={pct(m.self_sufficiency_rate)}   rec={isRec} />
      </View>
    </View>
  );
}

function OfferRow({ label, value, rec, bold }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontSize: 7, color: rec ? 'rgba(255,255,255,0.65)' : C.gray }}>{label}</Text>
      <Text style={{ fontSize: bold ? 8 : 7, fontFamily: bold ? B : R, color: rec ? C.white : C.grayDark }}>{value}</Text>
    </View>
  );
}

function EcoCard({ title, value, unit }) {
  return (
    <View style={sh.ecoCard}>
      <Text style={sh.ecoCardTitle}>{title}</Text>
      <Text style={sh.ecoCardValue}>{value}</Text>
      <Text style={sh.ecoCardUnit}>{unit}</Text>
    </View>
  );
}

// ── Page 4: Signatures ─────────────────────────────────────────────────
function SignaturePage({ intake }) {
  return (
    <Page size="A4" style={sh.contentPage}>
      <PageHeader section="Section 03" title="Signatures & Date" />
      <View style={sh.pageBody}>
        <Text style={sh.sigIntroText}>
          By signing below, the client confirms that they have reviewed and accepted the
          solar installation proposal described in this report, including the technical
          specifications and the commercial conditions.
        </Text>

        <SubTitle>Project Reference</SubTitle>
        <View style={sh.grid}>
          <Field label="Client"      value={intake.name}       full />
          <Field label="Address"     value={intake.address}    full />
          <Field label="Postcode"    value={intake.postalCode} />
          <Field label="Report date" value={today} />
        </View>

        <SubTitle>Date of Agreement</SubTitle>
        <View style={sh.dateRow}>
          <Text style={sh.dateLbl}>Location, Date</Text>
          <View style={sh.dateLine} />
        </View>

        <SubTitle>Signatures</SubTitle>
        <View style={sh.sigRow}>
          <SigBox title="Client"  role="Customer" />
          <SigBox title="Company" role="Authorized Representative" />
        </View>

        <View style={sh.legalBox}>
          <Text style={sh.legalText}>
            This document is confidential and intended solely for the use of the addressee.
            All estimates are based on data provided by the client and publicly available solar
            irradiation data for the stated location. Actual performance may vary.
          </Text>
        </View>
      </View>
      <Footer />
    </Page>
  );
}

function SigBox({ title, role }) {
  return (
    <View style={sh.sigBox}>
      <Text style={sh.sigBoxTitle}>{title}</Text>
      <Text style={sh.sigRole}>{role}</Text>
      <View style={sh.sigNameLine} />
      <Text style={sh.sigLineLbl}>Name (print)</Text>
      <View style={sh.sigSignLine} />
      <Text style={sh.sigLineLbl}>Signature</Text>
    </View>
  );
}

// ── Root document ──────────────────────────────────────────────────────
export default function SolarReportPDF({ intake, pipelineData, screenshot }) {
  return (
    <Document title="Solar Installation Report" author="Tectum">
      <CoverPage    intake={intake} screenshot={screenshot} />
      <EnergyPage   intake={intake} pipelineData={pipelineData} />
      <EconomicPage pipelineData={pipelineData} />
      <SignaturePage intake={intake} />
    </Document>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────
const sh = StyleSheet.create({
  coverPage:       { backgroundColor: C.white },
  coverTop:        { height: 480, position: 'relative' },
  coverSvg:        { position: 'absolute', top: 0, left: 0, width: '100%', height: 480 },
  coverScreenshot: { position: 'absolute', top: 16, left: 16, right: 16, height: 240, opacity: 0.92 },
  coverTitleBlock: { position: 'absolute', bottom: 48, left: 48 },
  coverEyebrow:    { color: C.greenAccent, fontFamily: B, fontSize: 10, letterSpacing: 3, marginBottom: 10 },
  coverTitle:      { color: C.white, fontFamily: B, fontSize: 36, lineHeight: 1.1 },
  coverAccentLine: { width: 64, height: 4, backgroundColor: C.greenAccent, marginTop: 16 },
  coverBottom:     { padding: '28 48' },
  coverMetaGrid:   { flexDirection: 'row', flexWrap: 'wrap' },
  coverMetaItem:   { width: '33.33%', marginBottom: 18, paddingRight: 12 },
  coverMetaLabel:  { color: C.grayLight, fontSize: 7.5, fontFamily: B, letterSpacing: 1, marginBottom: 3, textTransform: 'uppercase' },
  coverMetaValue:  { fontFamily: B, fontSize: 10.5, color: C.grayDark },
  coverStripe:     { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.green, padding: '8 48' },
  coverStripeText: { color: 'rgba(255,255,255,0.55)', fontSize: 8, letterSpacing: 1 },

  contentPage:       { fontFamily: R, fontSize: 9, color: C.grayDark, backgroundColor: C.white, paddingBottom: 52 },
  pageHeader:        { backgroundColor: C.green, padding: '12 48', marginBottom: 20 },
  pageHeaderSection: { color: C.greenAccent, fontFamily: B, fontSize: 8, letterSpacing: 2, marginBottom: 2 },
  pageHeaderTitle:   { color: C.white, fontFamily: B, fontSize: 15 },
  pageHeaderDate:    { position: 'absolute', right: 48, top: 20, color: 'rgba(255,255,255,0.5)', fontSize: 8 },
  pageBody:          { paddingHorizontal: 48 },

  recBadge:     { backgroundColor: C.blueLight, border: '1pt solid ' + C.blueMid, borderRadius: 4, padding: '5 10', marginBottom: 10 },
  recBadgeText: { fontSize: 8, color: C.blueMid, fontFamily: B },

  kpiRow:  { flexDirection: 'row', backgroundColor: C.greenLight, borderWidth: 1, borderColor: C.border, marginBottom: 14, borderRadius: 4, overflow: 'hidden' },
  kpiItem: { flex: 1, alignItems: 'center', padding: '10 6', borderRightWidth: 1, borderRightColor: C.border },
  kpiLast: { flex: 1, alignItems: 'center', padding: '10 6' },
  kpiVal:  { fontFamily: B, fontSize: 20, color: C.green },
  kpiLbl:  { color: C.gray, fontSize: 7, marginTop: 3, textAlign: 'center' },

  subTitleWrap: { marginTop: 12, marginBottom: 6 },
  subTitle:     { fontFamily: B, fontSize: 9, color: C.greenMid, textTransform: 'uppercase', letterSpacing: 0.5, borderBottomWidth: 1.5, borderBottomColor: C.greenMid, paddingBottom: 3 },

  grid:   { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  lv:     { width: '50%', flexDirection: 'row', padding: '3 8', marginBottom: 1 },
  lvFull: { width: '100%', flexDirection: 'row', padding: '3 8', marginBottom: 1 },
  lbl:    { color: C.gray, width: 110, fontSize: 8 },
  val:    { fontFamily: B, fontSize: 8, flex: 1 },

  // Offer comparison cards
  offerRow:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
  offerCard:      { flex: 1, border: '1pt solid ' + C.border, borderRadius: 5, padding: '10 10', backgroundColor: C.bg },
  offerCardRec:   { backgroundColor: C.green, borderColor: C.green },
  offerCardTitle: { fontFamily: B, fontSize: 9, color: C.greenMid, marginBottom: 2 },
  offerRecLabel:  { fontSize: 6.5, color: C.greenAccent, fontFamily: B, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },

  ecoCardRow:   { flexDirection: 'row', gap: 8, marginBottom: 12, marginTop: 10 },
  ecoCard:      { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: '10 10', backgroundColor: C.bg },
  ecoCardTitle: { fontFamily: B, fontSize: 7, color: C.gray, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 },
  ecoCardValue: { fontFamily: B, fontSize: 16, color: C.green },
  ecoCardUnit:  { fontSize: 7, color: C.gray, marginTop: 2 },

  tHead:       { flexDirection: 'row', backgroundColor: C.green, padding: '5 8' },
  tHc:         { color: C.white, fontFamily: B, fontSize: 7.5 },
  tRow:        { flexDirection: 'row', padding: '4 8', borderBottomWidth: 0.5, borderBottomColor: C.border, alignItems: 'center' },
  tRowAlt:     { backgroundColor: C.bg },
  tCell:       { fontSize: 8 },

  sigIntroText: { fontSize: 9, color: C.gray, lineHeight: 1.6, marginBottom: 4, backgroundColor: C.bg, padding: '10 14', borderRadius: 4, borderWidth: 1, borderColor: C.border },
  dateRow:      { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 6, padding: '0 8' },
  dateLbl:      { fontFamily: B, fontSize: 9, color: C.greenMid, width: 90, flexShrink: 0 },
  dateLine:     { flex: 1, borderBottomWidth: 1, borderBottomColor: C.grayDark, height: 24 },
  sigRow:       { flexDirection: 'row', gap: 20, marginBottom: 16 },
  sigBox:       { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: '14 16' },
  sigBoxTitle:  { fontFamily: B, fontSize: 9, color: C.green, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  sigRole:      { fontSize: 8, color: C.gray, marginBottom: 28 },
  sigNameLine:  { borderBottomWidth: 1, borderBottomColor: C.grayDark, marginBottom: 4, height: 24 },
  sigLineLbl:   { fontSize: 7.5, color: C.grayLight, marginBottom: 18 },
  sigSignLine:  { borderBottomWidth: 1, borderBottomColor: C.grayDark, marginBottom: 4, height: 32 },
  legalBox:     { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: '10 14' },
  legalText:    { fontSize: 7, color: C.grayLight, lineHeight: 1.6 },

  footer:  { position: 'absolute', bottom: 18, left: 48, right: 48, borderTopWidth: 0.5, borderTopColor: C.border, paddingTop: 5, flexDirection: 'row', justifyContent: 'space-between' },
  footerL: { color: '#bbb', fontSize: 7 },
  footerR: { color: C.greenMid, fontSize: 7, fontFamily: B },
});
