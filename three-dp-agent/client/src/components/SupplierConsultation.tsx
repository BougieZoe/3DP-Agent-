/**
 * Supplier Consultation - Premium Advisory Route
 * Design: High-end magazine layout, minimalist, elegant
 */

interface Supplier {
  name: string;
  specialty: string;
  description: string;
  materials: string[];
  leadTime: string;
}

const suppliers: Supplier[] = [
  {
    name: 'Precision Labs',
    specialty: 'High-Precision SLA',
    description: 'Specializes in ultra-fine detail work with exceptional surface finish.',
    materials: ['Resin', 'Castable Resin'],
    leadTime: '5-7 days',
  },
  {
    name: 'Robust Manufacturing',
    specialty: 'Industrial FDM',
    description: 'Heavy-duty production with reinforced materials for functional parts.',
    materials: ['PETG', 'Nylon', 'Carbon Fiber'],
    leadTime: '3-5 days',
  },
  {
    name: 'Artisan Crafts',
    specialty: 'Aesthetic Finishing',
    description: 'Expert post-processing and finishing for display models.',
    materials: ['PLA', 'ABS', 'Specialty Filaments'],
    leadTime: '7-10 days',
  },
];

export function SupplierConsultation() {
  return (
    <section className="min-h-screen bg-background px-8 py-20">
      <div className="max-w-5xl mx-auto space-y-20">
        {/* Section Header */}
        <div className="space-y-4">
          <div className="font-mono text-xs tracking-widest text-muted-foreground opacity-60">
            ADVISORY CONSULTATION
          </div>
          <h2 className="font-serif text-6xl font-bold text-foreground">
            Recommended Partners
          </h2>
          <p className="font-mono text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Based on your model analysis, we have identified specialized partners perfectly suited
            to your project requirements.
          </p>
        </div>

        {/* Suppliers Grid - Magazine Style */}
        <div className="space-y-16">
          {suppliers.map((supplier, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-16 border-b border-border last:border-b-0"
            >
              {/* Left: Name and Specialty */}
              <div className="space-y-3 md:col-span-1">
                <h3 className="font-serif text-3xl font-bold text-foreground">
                  {supplier.name}
                </h3>
                <div className="font-mono text-xs tracking-widest text-accent opacity-80">
                  {supplier.specialty}
                </div>
              </div>

              {/* Center: Description */}
              <div className="md:col-span-1">
                <p className="font-mono text-sm text-muted-foreground leading-relaxed">
                  {supplier.description}
                </p>
              </div>

              {/* Right: Details */}
              <div className="space-y-4 md:col-span-1">
                <div className="space-y-2">
                  <div className="font-mono text-xs text-muted-foreground opacity-70">
                    MATERIALS
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {supplier.materials.map((mat, i) => (
                      <span
                        key={i}
                        className="font-mono text-xs px-3 py-1 bg-secondary rounded text-foreground"
                      >
                        {mat}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-mono text-xs text-muted-foreground opacity-70">
                    LEAD TIME
                  </div>
                  <div className="font-serif text-lg font-bold text-foreground">
                    {supplier.leadTime}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Call to Action */}
        <div className="text-center space-y-6 pt-8">
          <p className="font-mono text-sm text-muted-foreground max-w-2xl mx-auto">
            Each recommendation is tailored to your specific model requirements and production goals.
          </p>
          <button className="font-serif text-lg font-bold text-accent hover:text-primary transition-colors">
            Request Detailed Quote
          </button>
        </div>
      </div>
    </section>
  );
}
