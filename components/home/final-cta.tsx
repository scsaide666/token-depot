import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function FinalCta() {
  return (
    <section id="get-started" className="v-final-cta v-frame" aria-labelledby="final-cta-heading">
      <p className="v-kicker">Start with Token Depot</p>
      <h2 id="final-cta-heading">Your next idea.<br />One API away.</h2>
      <p>Create an account. Get your key. Start building.</p>
      <div className="v-actions"><Button asChild><Link href="/register">Get Started <ArrowRight size={15} aria-hidden="true" /></Link></Button><Button variant="outline" asChild><Link href="/docs">View Documentation <ArrowUpRight size={15} aria-hidden="true" /></Link></Button></div>
    </section>
  );
}

