import { PARTNER_ROSTER } from './partnerRoster';

describe('PARTNER_ROSTER', () => {
  it('每条记录都有完整字段', () => {
    for (const partner of Object.values(PARTNER_ROSTER)) {
      expect(partner.partnerId).toBeDefined();
      expect(partner.processTypes.length).toBeGreaterThan(0);
      expect(partner.buildSize.widthMm).toBeGreaterThan(0);
    }
  });
});
