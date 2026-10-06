import { Link } from 'wouter';
import { Shell, PageHead } from '@/components/shell';

export default function Home() {
  return (
    <Shell>
      <div className="grid-bg -mx-4 px-4 py-8 mb-8 rounded">
        <div className="bg-background/90 max-w-3xl p-4 border border-border rounded">
          <PageHead label="About this workspace" title="Look at what the saved record actually shows.">
            Community Bail Research lets a small volunteer team enter bail observations that came from real, linked court sources, review them, and see a plain descriptive range of confirmed amounts.
          </PageHead>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-in" className="btn btn-primary" data-testid="button-sign-in-hero">Sign in to the workspace</Link>
            <Link href="/sign-up" className="btn" data-testid="button-sign-up-hero">Create an account</Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="panel">
          <div className="bracket mb-2">What it does</div>
          <ul className="list-disc pl-5 space-y-2">
            <li>Search records you have saved, by docket number, county, court level, or charge group.</li>
            <li>Enter a bail observation by hand with a required source link and an evidence note.</li>
            <li>Review each entry against its source. Only confirmed, reviewed-operative numeric observations feed a range, separated by category and basis.</li>
            <li>See minimum, median, and maximum for one explicit financial basis at a time.</li>
          </ul>
        </section>
        <section className="panel">
          <div className="bracket mb-2">What it does not do</div>
          <ul className="list-disc pl-5 space-y-2">
            <li>It does not recommend bail for any individual, or judge release eligibility or risk.</li>
            <li>It does not search countywide sources. No live source adapters or uploads are enabled in this first version.</li>
            <li>It does not verify custody status.</li>
            <li>It has no name-based search.</li>
          </ul>
        </section>
        <section className="notice md:col-span-2" data-testid="notice-real-records">
          <div className="bracket mb-1">Records must be real</div>
          <p>
            Every record must come from an actual court source you can link to. This workspace starts empty and contains no sample or placeholder dockets. Do not enter invented, illustrative, or test cases.
          </p>
        </section>
        <section className="panel md:col-span-2">
          <div className="bracket mb-2">Access in this version</div>
          <p>
            Sign-in is required to use the workspace. In this version, saved records are stored per signed-in user. Shared team permissions are a later setup step.
          </p>
        </section>
      </div>
    </Shell>
  );
}
