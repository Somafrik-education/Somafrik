import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  AppLayout,
  DashboardLayout,
  FormLayout,
  ListLayout,
  RecordLayout,
  ToolLayout,
  WizardLayout,
} from "./index";

describe("layout slots API", () => {
  it("RecordLayout renders compound slots in D1.3 order", () => {
    const { container } = render(
      <RecordLayout>
        <RecordLayout.Header>Header</RecordLayout.Header>
        <RecordLayout.Summary>Summary</RecordLayout.Summary>
        <RecordLayout.Alerts>Alerts</RecordLayout.Alerts>
        <RecordLayout.PrimaryActions>Primary</RecordLayout.PrimaryActions>
        <RecordLayout.SecondaryActions>Secondary</RecordLayout.SecondaryActions>
        <RecordLayout.Tabs>Tabs</RecordLayout.Tabs>
        <RecordLayout.Content>Content</RecordLayout.Content>
        <RecordLayout.Sidebar>Sidebar</RecordLayout.Sidebar>
        <RecordLayout.History>History</RecordLayout.History>
      </RecordLayout>,
    );

    expect(screen.getByText("Header")).toBeInTheDocument();
    expect(screen.getByLabelText("Résumé métier")).toHaveTextContent("Summary");
    expect(screen.getByLabelText("Alertes")).toHaveTextContent("Alerts");
    expect(screen.getByLabelText("Sections de la fiche")).toHaveTextContent("Tabs");
    expect(screen.getByLabelText("Contenu")).toHaveTextContent("Content");
    expect(screen.getByLabelText("Panneau latéral")).toHaveTextContent("Sidebar");
    expect(screen.getByLabelText("Historique")).toHaveTextContent("History");
    const pageHeader = screen.getByRole("banner");
    expect(pageHeader).toHaveTextContent("Header");
    expect(pageHeader).toHaveTextContent("Primary");
    expect(pageHeader).toHaveTextContent("Secondary");

    const text = container.textContent ?? "";
    expect(text.indexOf("Header")).toBeLessThan(text.indexOf("Summary"));
    expect(text.indexOf("Summary")).toBeLessThan(text.indexOf("Alerts"));
    expect(text.indexOf("Alerts")).toBeLessThan(text.indexOf("Tabs"));
    expect(text.indexOf("Tabs")).toBeLessThan(text.indexOf("Content"));
    expect(text.indexOf("Content")).toBeLessThan(text.indexOf("History"));
  });

  it("RecordLayout prefers prop slots over compound children", () => {
    render(
      <RecordLayout header={<span>FromProp</span>}>
        <RecordLayout.Header>FromCompound</RecordLayout.Header>
        <RecordLayout.Content>Body</RecordLayout.Content>
      </RecordLayout>,
    );
    expect(screen.getByText("FromProp")).toBeInTheDocument();
    expect(screen.queryByText("FromCompound")).not.toBeInTheDocument();
  });

  it("ListLayout exposes semantic regions", () => {
    render(
      <ListLayout>
        <ListLayout.Header>Élèves</ListLayout.Header>
        <ListLayout.Description>Parcourir</ListLayout.Description>
        <ListLayout.Kpis>KPI</ListLayout.Kpis>
        <ListLayout.Filters>Filters</ListLayout.Filters>
        <ListLayout.PrimaryActions>Créer</ListLayout.PrimaryActions>
        <ListLayout.Content>Table</ListLayout.Content>
        <ListLayout.Footer>Page 1</ListLayout.Footer>
      </ListLayout>,
    );
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Indicateurs")).toHaveTextContent("KPI");
    expect(screen.getByLabelText("Filtres et recherche")).toHaveTextContent("Filters");
    expect(screen.getByLabelText("Liste")).toHaveTextContent("Table");
    expect(screen.getByRole("contentinfo")).toHaveTextContent("Page 1");
  });

  it("DashboardLayout stacks alerts before kpis when both present", () => {
    const { container } = render(
      <DashboardLayout
        header="TDB"
        alerts="Alert"
        kpis="KPI"
        primaryActions="Go"
        content="Charts"
      />,
    );
    const text = container.textContent ?? "";
    expect(text.indexOf("Alert")).toBeLessThan(text.indexOf("KPI"));
    expect(screen.getByLabelText("Alertes")).toBeInTheDocument();
    expect(screen.getByLabelText("Indicateurs")).toBeInTheDocument();
  });

  it("AppLayout uses aside + main landmarks", () => {
    render(
      <AppLayout>
        <AppLayout.Sidebar>
          <span>Nav</span>
        </AppLayout.Sidebar>
        <AppLayout.Header>
          <span>Top</span>
        </AppLayout.Header>
        <AppLayout.Banner>
          <span>Banner</span>
        </AppLayout.Banner>
        <AppLayout.Main>
          <span>Page</span>
        </AppLayout.Main>
      </AppLayout>,
    );
    expect(screen.getByRole("complementary")).toHaveTextContent("Nav");
    expect(screen.getByRole("banner")).toHaveTextContent("Top");
    const main = screen.getByRole("main");
    expect(within(main).getByText("Banner")).toBeInTheDocument();
    expect(within(main).getByText("Page")).toBeInTheDocument();
  });

  it("FormLayout keeps sticky actions in a footer landmark", () => {
    render(
      <FormLayout>
        <FormLayout.Header>Nouveau</FormLayout.Header>
        <FormLayout.Alerts>Err</FormLayout.Alerts>
        <FormLayout.Content>Fields</FormLayout.Content>
        <FormLayout.StickyActions>Save</FormLayout.StickyActions>
      </FormLayout>,
    );
    expect(screen.getByLabelText("Alertes")).toHaveTextContent("Err");
    expect(screen.getByLabelText("Formulaire")).toHaveTextContent("Fields");
    expect(screen.getByLabelText("Actions du formulaire")).toHaveTextContent("Save");
  });

  it("WizardLayout exposes step navigation landmark", () => {
    render(
      <WizardLayout>
        <WizardLayout.Header>Inscription</WizardLayout.Header>
        <WizardLayout.Stepper>1 / 3</WizardLayout.Stepper>
        <WizardLayout.Content>Step body</WizardLayout.Content>
        <WizardLayout.StickyActions>Suivant</WizardLayout.StickyActions>
      </WizardLayout>,
    );
    expect(screen.getByRole("navigation", { name: "Étapes du parcours" })).toHaveTextContent(
      "1 / 3",
    );
    expect(screen.getByLabelText("Étape courante")).toHaveTextContent("Step body");
  });

  it("ToolLayout exposes context and work zones", () => {
    render(
      <ToolLayout>
        <ToolLayout.Header>Présences</ToolLayout.Header>
        <ToolLayout.Context>Classe 6A</ToolLayout.Context>
        <ToolLayout.Content>Grid</ToolLayout.Content>
        <ToolLayout.StickyActions>Valider</ToolLayout.StickyActions>
      </ToolLayout>,
    );
    expect(screen.getByLabelText("Contexte opérationnel")).toHaveTextContent("Classe 6A");
    expect(screen.getByLabelText("Zone de travail")).toHaveTextContent("Grid");
    expect(screen.getByLabelText("Actions de l'outil")).toHaveTextContent("Valider");
  });

  it("default children fill Content when no Content slot is provided", () => {
    render(
      <ListLayout header="H">
        <div>Loose content</div>
      </ListLayout>,
    );
    expect(screen.getByLabelText("Liste")).toHaveTextContent("Loose content");
  });
});
