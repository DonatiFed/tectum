import React from 'react'
import { Document, Page, Text, View, StyleSheet, Svg, Circle, Rect } from '@react-pdf/renderer'
import type { IntakeData, SystemConfig, CostBreakdown, YieldEstimate } from '../lib/solar'

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
}
const B = 'Helvetica-Bold'
const R = 'Helvetica'

const today = new Date().toLocaleDateString('de-DE')
const fmtN = (n: number, dec = 0) => n.toFixed(dec)
const fmtEUR = (n: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

function Footer() {
  return (
    <View style={sh.footer} fixed>
      <Text style={sh.footerL}>Solar Installation Report  ·  Confidential</Text>
      <Text style={sh.footerR} render={({ pageNumber }: { pageNumber: number }) => `Page ${pageNumber}`} />
    </View>
  )
}

function Field({ label, value, full = false }: { label: string; value: string; full?: boolean }) {
  return (
    <View style={full ? sh.lvFull : sh.lv}>
      <Text style={sh.lbl}>{label}</Text>
      <Text style={sh.val}>{value}</Text>
    </View>
  )
}

function SubTitle({ children }: { children: string }) {
  return (
    <View style={sh.subTitleWrap}>
      <Text style={sh.subTitle}>{children}</Text>
    </View>
  )
}

function PageHeader({ section, title }: { section: string; title: string }) {
  return (
    <View style={sh.pageHeader} fixed>
      <View>
        <Text style={sh.pageHeaderSection}>{section}</Text>
        <Text style={sh.pageHeaderTitle}>{title}</Text>
      </View>
      <Text style={sh.pageHeaderDate}>{today}</Text>
    </View>
  )
}

// ── Cover ──────────────────────────────────────────────────────────────────────
function CoverPage({ intake }: { intake: IntakeData }) {
  return (
    <Page size="A4" style={sh.coverPage}>
      <View style={sh.coverTop}>
        <Svg style={sh.coverSvg} viewBox="0 0 595 480">
          <Rect x="0" y="0" width="595" height="480" fill={C.green} />
          <Circle cx="520" cy="90"  r="190" fill={C.greenMid}    opacity="0.45" />
          <Circle cx="-20" cy="430" r="140" fill={C.greenMid}    opacity="0.35" />
          <Circle cx="280" cy="500" r="240" fill={C.greenAccent} opacity="0.12" />
        </Svg>
        <View style={sh.coverTitleBlock}>
          <Text style={sh.coverEyebrow}>TECHNICAL REPORT</Text>
          <Text style={sh.coverTitle}>Solar Installation</Text>
          <Text style={sh.coverTitle}>Report</Text>
          <View style={sh.coverAccentLine} />
        </View>
      </View>

      <View style={sh.coverBottom}>
        <View style={sh.coverMetaGrid}>
          <CoverMeta label="Address"   value={intake.address || '—'} />
          <CoverMeta label="Postcode"  value={intake.postalCode || '—'} />
          <CoverMeta label="Generated" value={today} />
          <CoverMeta label="Roof type" value={intake.roofType} />
          <CoverMeta label="Orientation" value={intake.orientation} />
          <CoverMeta label="Roof area" value={`${intake.roofArea} m²`} />
        </View>
      </View>

      <View style={sh.coverStripe}>
        <Text style={sh.coverStripeText}>Confidential  ·  For Client Use Only</Text>
      </View>
    </Page>
  )
}

function CoverMeta({ label, value }: { label: string; value: string }) {
  return (
    <View style={sh.coverMetaItem}>
      <Text style={sh.coverMetaLabel}>{label}</Text>
      <Text style={sh.coverMetaValue}>{value}</Text>
    </View>
  )
}

// ── Energy & System ────────────────────────────────────────────────────────────
function EnergyPage({ intake, cfg, yield_ }: { intake: IntakeData; cfg: SystemConfig; yield_: YieldEstimate }) {
  const totalKwp = (cfg.panelCount * cfg.panelWattage / 1000)
  const kpis = [
    { val: fmtN(totalKwp, 2), lbl: 'System Size\n(kWp)' },
    { val: cfg.batteryKwh > 0 ? fmtN(cfg.batteryKwh, 1) : '—', lbl: 'Battery\n(kWh)' },
    { val: Math.round(yield_.yearlyKwh).toLocaleString('de-DE'), lbl: 'Annual Yield\n(kWh)' },
    { val: `${Math.round(yield_.selfConsumptionPercentage)}%`, lbl: 'Self\nConsumption' },
  ]

  return (
    <Page size="A4" style={sh.contentPage}>
      <PageHeader section="Section 01" title="Solar Installation — Energy Details" />
      <View style={sh.pageBody}>
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
          <Field label="Address"     value={intake.address || '—'} full />
          <Field label="Postcode"    value={intake.postalCode || '—'} />
          <Field label="Roof type"   value={intake.roofType} />
          <Field label="Roof area"   value={`${intake.roofArea} m²`} />
          <Field label="Orientation" value={intake.orientation} />
          <Field label="Monthly bill" value={`${intake.monthlyBill} €`} />
          <Field label="EV / Wallbox"  value={intake.evStatus === 'has' ? 'Installed' : intake.evStatus === 'wants' ? 'Requested' : 'None'} />
          <Field label="Heat pump"    value={intake.wantsHeatPump ? 'Requested' : intake.heatingType === 'heat_pump' ? 'Already installed' : 'Not included'} />
          <Field label="Heating type" value={intake.heatingType} />
        </View>

        <SubTitle>Proposed System</SubTitle>
        <View style={sh.grid}>
          <Field label="Solar panels"    value={`${cfg.panelCount} × ${cfg.panelWattage} W`} />
          <Field label="System size"     value={`${fmtN(totalKwp, 2)} kWp`} />
          <Field label="Battery storage" value={cfg.batteryKwh > 0 ? `${cfg.batteryKwh} kWh` : 'Not included'} />
          <Field label="Heat pump"       value={cfg.includeHeatPump ? 'Included' : 'Not included'} />
          <Field label="EV wallbox"      value={cfg.includeWallbox ? 'Included (11 kW)' : 'Not included'} />
        </View>

        <SubTitle>Yield Estimates</SubTitle>
        <View style={sh.grid}>
          <Field label="Annual yield"     value={`${Math.round(yield_.yearlyKwh).toLocaleString('de-DE')} kWh`} />
          <Field label="Self consumption" value={`${Math.round(yield_.selfConsumptionPercentage)}%`} />
          <Field label="Used on-site"     value={`${Math.round(yield_.usedKwh).toLocaleString('de-DE')} kWh`} />
          <Field label="Fed into grid"    value={`${Math.round(yield_.fedInKwh).toLocaleString('de-DE')} kWh`} />
          <Field label="CO₂ saved / year" value={`${(yield_.co2Saved / 1000).toFixed(1)} t`} />
        </View>
      </View>
      <Footer />
    </Page>
  )
}

// ── Economic ───────────────────────────────────────────────────────────────────
function EconomicPage({ cfg, costs, yield_ }: { cfg: SystemConfig; costs: CostBreakdown; yield_: YieldEstimate }) {
  return (
    <Page size="A4" style={sh.contentPage}>
      <PageHeader section="Section 02" title="Solar Installation — Economic Details" />
      <View style={sh.pageBody}>

        <View style={sh.ecoCardRow}>
          <EcoCard title="Net Investment"   value={fmtEUR(costs.netTotal)}          unit="after subsidies" />
          <EcoCard title="Annual Savings"   value={fmtEUR(yield_.yearlySavings)}    unit="€ / year" />
          <EcoCard title="Payback Period"   value={`${yield_.paybackYears} y`}      unit="estimated" />
        </View>

        <SubTitle>Cost Breakdown</SubTitle>
        <View style={sh.tHead}>
          <Text style={[sh.tHc, { flex: 3 }]}>Item</Text>
          <Text style={[sh.tHc, { flex: 2, textAlign: 'right' }]}>Amount (€)</Text>
        </View>
        {[
          { label: `Solar panels (${cfg.panelCount} × ${cfg.panelWattage} W)`, amount: costs.panels },
          { label: 'Inverter', amount: costs.inverter },
          { label: `Battery storage (${cfg.batteryKwh} kWh)`, amount: costs.battery },
          ...(cfg.includeHeatPump ? [{ label: 'Heat pump', amount: costs.heatPump }] : []),
          ...(cfg.includeWallbox  ? [{ label: 'EV wallbox (11 kW)', amount: costs.wallbox }] : []),
          { label: 'Installation', amount: costs.installation },
        ].map((row, i) => (
          <View key={i} style={[sh.tRow, i % 2 === 1 && sh.tRowAlt]}>
            <Text style={[sh.tCell, { flex: 3 }]}>{row.label}</Text>
            <Text style={[sh.tCell, { flex: 2, textAlign: 'right' }]}>{row.amount.toLocaleString('de-DE')} €</Text>
          </View>
        ))}
        <View style={sh.tTotalRow}>
          <Text style={[sh.tTotalCell, { flex: 3 }]}>Subtotal</Text>
          <Text style={[sh.tTotalCell, { flex: 2, textAlign: 'right' }]}>{costs.total.toLocaleString('de-DE')} €</Text>
        </View>
        {costs.subsidy > 0 && (
          <View style={sh.tSubsidyRow}>
            <Text style={[sh.tCell, { flex: 3, color: C.greenMid }]}>Subsidies &amp; grants</Text>
            <Text style={[sh.tCell, { flex: 2, textAlign: 'right', color: C.greenMid }]}>− {costs.subsidy.toLocaleString('de-DE')} €</Text>
          </View>
        )}
        <View style={sh.tNetRow}>
          <Text style={[sh.tNetCell, { flex: 3 }]}>Net investment</Text>
          <Text style={[sh.tNetCell, { flex: 2, textAlign: 'right' }]}>{costs.netTotal.toLocaleString('de-DE')} €</Text>
        </View>

        <SubTitle>Energy Price Projection</SubTitle>
        <Text style={sh.noteText}>
          Assuming €0.35/kWh today with 4% annual increase. Savings grow as grid prices rise.
        </Text>
        <View style={sh.tHead}>
          <Text style={[sh.tHc, { flex: 1 }]}>Year</Text>
          <Text style={[sh.tHc, { flex: 2 }]}>Price (€/kWh)</Text>
          <Text style={[sh.tHc, { flex: 2, textAlign: 'right' }]}>Est. Savings (€)</Text>
        </View>
        {[1, 5, 10, 15, 20].map((yr, i) => {
          const price = 0.35 * Math.pow(1.04, yr - 1)
          const savings = yield_.usedKwh * price + yield_.fedInKwh * 0.082
          return (
            <View key={yr} style={[sh.tRow, i % 2 === 1 && sh.tRowAlt]}>
              <Text style={[sh.tCell, { flex: 1 }]}>{yr}</Text>
              <Text style={[sh.tCell, { flex: 2 }]}>{price.toFixed(3)}</Text>
              <Text style={[sh.tCell, { flex: 2, textAlign: 'right' }]}>{Math.round(savings).toLocaleString('de-DE')}</Text>
            </View>
          )
        })}
      </View>
      <Footer />
    </Page>
  )
}

function EcoCard({ title, value, unit }: { title: string; value: string; unit: string }) {
  return (
    <View style={sh.ecoCard}>
      <Text style={sh.ecoCardTitle}>{title}</Text>
      <Text style={sh.ecoCardValue}>{value}</Text>
      <Text style={sh.ecoCardUnit}>{unit}</Text>
    </View>
  )
}

// ── Signatures ─────────────────────────────────────────────────────────────────
function SignaturePage({ intake }: { intake: IntakeData }) {
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
          <Field label="Address"   value={intake.address || '—'} full />
          <Field label="Postcode"  value={intake.postalCode || '—'} />
          <Field label="Report date" value={today} />
        </View>

        <SubTitle>Date of Agreement</SubTitle>
        <View style={sh.dateRow}>
          <Text style={sh.dateLbl}>Location, Date</Text>
          <View style={sh.dateLine} />
        </View>

        <SubTitle>Signatures</SubTitle>
        <View style={sh.sigRow}>
          <SigBox title="Client" role="Customer" />
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
  )
}

function SigBox({ title, role }: { title: string; role: string }) {
  return (
    <View style={sh.sigBox}>
      <Text style={sh.sigBoxTitle}>{title}</Text>
      <Text style={sh.sigRole}>{role}</Text>
      <View style={sh.sigNameLine} />
      <Text style={sh.sigLineLbl}>Name (print)</Text>
      <View style={sh.sigSignLine} />
      <Text style={sh.sigLineLbl}>Signature</Text>
    </View>
  )
}

// ── Root document ──────────────────────────────────────────────────────────────
interface SolarReportPDFProps {
  intake: IntakeData
  cfg: SystemConfig
  costs: CostBreakdown
  yield_: YieldEstimate
}

export default function SolarReportPDF({ intake, cfg, costs, yield_ }: SolarReportPDFProps) {
  return (
    <Document title="Solar Installation Report" author="tectum">
      <CoverPage  intake={intake} />
      <EnergyPage   intake={intake} cfg={cfg} yield_={yield_} />
      <EconomicPage cfg={cfg} costs={costs} yield_={yield_} />
      <SignaturePage intake={intake} />
    </Document>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const sh = StyleSheet.create({
  coverPage:       { backgroundColor: C.white },
  coverTop:        { height: 480, position: 'relative' },
  coverSvg:        { position: 'absolute', top: 0, left: 0, width: '100%', height: 480 },
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

  contentPage:      { fontFamily: R, fontSize: 9, color: C.grayDark, backgroundColor: C.white, paddingBottom: 52 },
  pageHeader:       { backgroundColor: C.green, padding: '12 48', marginBottom: 20 },
  pageHeaderSection:{ color: C.greenAccent, fontFamily: B, fontSize: 8, letterSpacing: 2, marginBottom: 2 },
  pageHeaderTitle:  { color: C.white, fontFamily: B, fontSize: 15 },
  pageHeaderDate:   { position: 'absolute', right: 48, top: 20, color: 'rgba(255,255,255,0.5)', fontSize: 8 },
  pageBody:         { paddingHorizontal: 48 },

  kpiRow:  { flexDirection: 'row', backgroundColor: C.greenLight, borderWidth: 1, borderColor: C.border, marginBottom: 18, borderRadius: 4, overflow: 'hidden' },
  kpiItem: { flex: 1, alignItems: 'center', padding: '10 6', borderRightWidth: 1, borderRightColor: C.border },
  kpiLast: { flex: 1, alignItems: 'center', padding: '10 6' },
  kpiVal:  { fontFamily: B, fontSize: 22, color: C.green },
  kpiLbl:  { color: C.gray, fontSize: 7, marginTop: 3, textAlign: 'center' },

  subTitleWrap: { marginTop: 14, marginBottom: 8 },
  subTitle:     { fontFamily: B, fontSize: 9, color: C.greenMid, textTransform: 'uppercase', letterSpacing: 0.5, borderBottomWidth: 1.5, borderBottomColor: C.greenMid, paddingBottom: 3 },

  grid:   { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  lv:     { width: '50%', flexDirection: 'row', padding: '3.5 8', marginBottom: 1 },
  lvFull: { width: '100%', flexDirection: 'row', padding: '3.5 8', marginBottom: 1 },
  lbl:    { color: C.gray, width: 130, fontSize: 8.5 },
  val:    { fontFamily: B, fontSize: 8.5, flex: 1 },

  tHead:       { flexDirection: 'row', backgroundColor: C.green, padding: '5 8' },
  tHc:         { color: C.white, fontFamily: B, fontSize: 7.5 },
  tRow:        { flexDirection: 'row', padding: '4 8', borderBottomWidth: 0.5, borderBottomColor: C.border },
  tRowAlt:     { backgroundColor: C.bg },
  tCell:       { fontSize: 8 },
  tTotalRow:   { flexDirection: 'row', padding: '5 8', borderTopWidth: 1, borderTopColor: C.border, marginTop: 2 },
  tTotalCell:  { fontSize: 8.5, fontFamily: B },
  tSubsidyRow: { flexDirection: 'row', padding: '4 8' },
  tNetRow:     { flexDirection: 'row', padding: '7 8', backgroundColor: C.green, marginTop: 1, borderRadius: 2 },
  tNetCell:    { fontSize: 9, fontFamily: B, color: C.white },

  ecoCardRow:        { flexDirection: 'row', gap: 10, marginBottom: 14 },
  ecoCard:           { flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: '12 14', backgroundColor: C.bg },
  ecoCardTitle:      { fontFamily: B, fontSize: 7.5, color: C.gray, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  ecoCardValue:      { fontFamily: B, fontSize: 22, color: C.green },
  ecoCardUnit:       { fontSize: 8, color: C.gray, marginTop: 2 },
  noteText:          { fontSize: 8, color: C.gray, marginBottom: 10, lineHeight: 1.4 },

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
})
