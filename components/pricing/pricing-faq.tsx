"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { pricingFAQs } from "@/lib/pricing-content";

export function PricingFAQ() {
  return <Accordion type="single" collapsible className="mt-8 border-t border-border">
    {pricingFAQs.map((faq) => <AccordionItem key={faq.id} value={faq.id}>
      <AccordionTrigger>{faq.question}</AccordionTrigger>
      <AccordionContent>{faq.answer}</AccordionContent>
    </AccordionItem>)}
  </Accordion>;
}
