import { Component, OnInit } from '@angular/core';
import { environment } from "../../environments/environment";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { Order } from "../merchant-orders/merchant-orders.component";

@Component({
  standalone: false,
  selector: 'app-order-detail',
  templateUrl: './order-detail.component.html',
  styleUrls: ['./order-detail.component.css']
})
export class OrderDetailComponent implements OnInit {

  order:Order=null;
  loading:boolean=true;
  loadError:string=null;
  message:string=null;
  updating:boolean=false;

  constructor(private http:HttpClient, private route:ActivatedRoute, private router:Router) { }

  ngOnInit() {
    if (sessionStorage.getItem("userData") == null) {
      this.router.navigate(['login']);
      return;
    }
    // Subscribe to the route params rather than reading a one-time snapshot - navigating
    // from one order's detail page straight to another's reuses this same component
    // instance, so ngOnInit never runs again and a snapshot read here would go stale.
    this.route.paramMap.subscribe(() => this.getOrder());
  }

  clearLocal(){
    sessionStorage.clear();
  }

  getOrder():void{
    const id = this.route.snapshot.paramMap.get('id');
    this.order = null;
    this.loading = true;
    this.loadError = null;
    let url = `${environment.apiUrl}/merchant/orders/${id}`;
    this.http.get<Order>(url).subscribe({
      next: (order) => {
        this.loading = false;
        this.order = order;
      },
      error: () => {
        this.loading = false;
        this.loadError = "Couldn't load this order. It may not exist.";
      }
    });
  }

  get itemCount():number{
    return this.order ? this.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  }

  // Only the forward move from the order's current status, or a reject - matches the
  // backend's fulfilment pipeline (PAID -> CONFIRMED -> READY -> DISPATCHED).
  get nextAction():{label:string, status:string}|null{
    switch (this.order?.status) {
      case 'PAID': return { label: 'Accept order', status: 'CONFIRMED' };
      case 'CONFIRMED': return { label: 'Mark ready', status: 'READY' };
      case 'READY': return { label: 'Mark dispatched', status: 'DISPATCHED' };
      default: return null;
    }
  }

  get canReject():boolean{
    return this.order?.status === 'PAID' || this.order?.status === 'CONFIRMED';
  }

  updateStatus(newStatus:string):void{
    if (this.updating || !this.order) return;
    this.message = null;
    this.updating = true;
    let url = `${environment.apiUrl}/merchant/orders/${this.order.id}/status`;
    this.http.post<Order>(url, { status: newStatus }).subscribe({
      next: (updated) => {
        this.updating = false;
        this.order = updated;
      },
      error: (err) => {
        this.updating = false;
        this.message = typeof err.error === 'string' ? err.error : "Couldn't update this order. Please try again.";
      }
    });
  }

  statusLabel(status:string):string{
    const labels:{[key:string]:string} = {
      PENDING: 'Awaiting payment',
      PAID: 'New',
      CONFIRMED: 'Confirmed',
      READY: 'Ready to dispatch',
      DISPATCHED: 'Dispatched',
      REJECTED: 'Rejected',
    };
    return labels[status] || status;
  }
}
