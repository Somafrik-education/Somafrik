import { useNavigate } from "react-router-dom";
import { Button, Card, FormLayout, SectionHeader } from "@/design-system";
import { SCHOOL_SETUP_SETTINGS_PATH } from "../../lib/schoolSetupWeb";

export function SchoolSetupWelcomePage() {
  const navigate = useNavigate();

  return (
    <FormLayout>
      <FormLayout.Header>
        <SectionHeader
          title="Bienvenue sur Somafrik"
          description="Préparez votre établissement en suivant un assistant guidé. Vous pourrez quitter et reprendre plus tard."
        />
      </FormLayout.Header>
      <FormLayout.Content>
        <Card className="space-y-4 p-6">
          <p className="text-sm text-muted">
            La configuration minimale (établissement, année, structure, matières, enseignants, élèves)
            rend votre établissement opérationnel. Les étapes suivantes restent accessibles ensuite.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => navigate(SCHOOL_SETUP_SETTINGS_PATH)}>
              Configurer mon établissement
            </Button>
            <Button type="button" variant="secondary" onClick={() => navigate("/etablissement", { replace: true })}>
              Quitter et reprendre plus tard
            </Button>
          </div>
        </Card>
      </FormLayout.Content>
    </FormLayout>
  );
}
