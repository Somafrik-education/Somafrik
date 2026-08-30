import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getDefaultAppPath } from "../lib/superAdminAccess";
import { marketingSkipLink } from "../data/marketingContent";
import { MarketingHeader } from "../components/marketing/MarketingHeader";
import { HeroSection } from "../components/marketing/HeroSection";
import { ProductSection } from "../components/marketing/ProductSection";
import { BenefitsSection } from "../components/marketing/BenefitsSection";
import { FeaturesSection } from "../components/marketing/FeaturesSection";
import { BusinessProofsSection } from "../components/marketing/BusinessProofsSection";
import { WebMobileSection } from "../components/marketing/WebMobileSection";
import { AudiencesSection } from "../components/marketing/AudiencesSection";
import { SecuritySection } from "../components/marketing/SecuritySection";
import { FinalCtaSection } from "../components/marketing/FinalCtaSection";
import { MarketingFooter } from "../components/marketing/MarketingFooter";

/**
 * Vitrine publique.
 * Framer Motion n’est plus utilisé ici. La dépendance reste dans package.json
 * tant qu’aucun autre écran ne la consomme encore — ne pas la retirer dans ce lot.
 */
export function LandingPage() {
  const { session, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && session?.accessToken && !session.user?.mustChangePassword) {
      navigate(getDefaultAppPath(session.user?.role), { replace: true });
    }
  }, [isAuthenticated, session, navigate]);

  return (
    <div className="min-h-screen overflow-x-clip bg-white text-ink">
      <a
        href={marketingSkipLink.href}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:font-bold focus:text-white"
      >
        {marketingSkipLink.label}
      </a>
      <MarketingHeader />
      <main id="contenu">
        <HeroSection />
        <ProductSection />
        <BenefitsSection />
        <FeaturesSection />
        <BusinessProofsSection />
        <WebMobileSection />
        <AudiencesSection />
        <SecuritySection />
        <FinalCtaSection />
      </main>
      <MarketingFooter />
    </div>
  );
}
