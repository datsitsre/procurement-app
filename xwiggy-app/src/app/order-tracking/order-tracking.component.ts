import { Component, OnInit } from '@angular/core';
import { environment } from "../../environments/environment";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { Order } from "../merchant-orders/merchant-orders.component";

/** The customer-facing fulfilment pipeline, in order - mirrors the backend's PIPELINE list. */
const PIPELINE = [
  { status: 'PAID', label: 'Order placed' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'READY', label: 'Ready' },
  { status: 'DISPATCHED', label: 'Delivered' },
];

@Component({
  standalone: false,
  selector: 'app-order-tracking',
  templateUrl: './order-tracking.component.html',
  styleUrls: ['./order-tracking.component.css']
})
export class OrderTrackingComponent implements OnInit {

  order:Order=null;
  loading:boolean=true;
  loadError:string=null;

  constructor(private http:HttpClient, private route:ActivatedRoute, private router:Router) { }

  ngOnInit() {
    if (sessionStorage.getItem("userData") == null) {
      this.router.navigate(['login']);
      return;
    }
    // Subscribe to the route params rather than reading a one-time snapshot - navigating
    // from one order's tracking page straight to another's reuses this same component
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
    let url = `${environment.apiUrl}/orders/${id}`;
    this.http.get<Order>(url).subscribe({
      next: (order) => {
        this.loading = false;
        this.order = order;
      },
      error: (err) => {
        this.loading = false;
        this.loadError = err.status === 403
          ? "That order doesn't belong to your account."
          : "Couldn't load this order. It may not exist.";
      }
    });
  }

  get itemCount():number{
    return this.order ? this.order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
  }

  get steps(){
    return PIPELINE;
  }

  get currentStepIndex():number{
    if (!this.order) return -1;
    return PIPELINE.findIndex(s => s.status === this.order.status);
  }

  stepState(index:number):'done'|'active'|'upcoming'{
    const current = this.currentStepIndex;
    if (current < 0) return 'upcoming';
    if (index < current) return 'done';
    if (index === current) return 'active';
    return 'upcoming';
  }

  resumePayment():void{
    if (!this.order) return;
    sessionStorage.setItem('orderId', String(this.order.id));
    sessionStorage.setItem('total', String(this.order.total));
    this.router.navigate(['checkout']);
  }
}
