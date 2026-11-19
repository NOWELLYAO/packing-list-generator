import { Component, type ReactNode } from 'react';

/** Une erreur dans un bloc (vue 3D, animation…) n'efface plus toute la page : le bloc affiche un message à la place */
export default class SafeBoundary extends Component<{ children: ReactNode; label?: string }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.error)
      return (
        <div className="banner warn" role="alert">
          {this.props.label ?? 'Cet affichage'} n'a pas pu être dessiné ({this.state.error}). Le reste de l'application fonctionne ; signalez-le avec une capture.{' '}
          <button className="btn small" onClick={() => this.setState({ error: null })}>
            Réessayer
          </button>
        </div>
      );
    return this.props.children;
  }
}
